/**
 * <pc-buy-box> — buy box único de Pronto Chocho.
 * Markup y datos: snippets/pc-buy-box.liquid.
 *
 * - Listeners delegados en el constructor: sobrevive a re-renders del editor
 *   y al morph de Horizon sin duplicar handlers.
 * - Una sola petición /cart/add.js (principal + sabores extra).
 * - Integra con Horizon vía CartAddEvent de '@theme/events' (fallback a
 *   CustomEvent con la misma forma) y refresca cart-items-component.
 */

const themeEvents = import('@theme/events').catch(() => null);

const clampQty = (n) => Math.max(1, Math.min(99, Number.parseInt(n, 10) || 1));

class PcBuyBox extends HTMLElement {
  constructor() {
    super();
    this.busy = false;
    this.addEventListener('change', (e) => this.onChange(e));
    this.addEventListener('click', (e) => this.onClick(e));
  }

  connectedCallback() {
    const raw = this.querySelector('script[data-pc-data]');
    if (!raw) return;
    try {
      this.data = JSON.parse(raw.textContent);
    } catch (err) {
      console.error('[pc-buy-box] JSON inválido', err);
      return;
    }

    const d = this.data;
    d.codes = (d.codes || []).filter(Boolean);
    this.money = new Intl.NumberFormat(d.locale || 'en', { style: 'currency', currency: d.currency || 'USD' });
    this.state = this.state || {
      type: d.type,
      variantId: d.variantId,
      planId: d.planId,
      qty: 1,
      extras: Object.fromEntries((d.extras || []).map((x) => [x.id, 0]))
    };

    this.$ = (sel) => this.querySelector(sel);
    this.addButton = this.$('[data-pc-add]');
    this.attachSticky();
    this.render();
  }

  disconnectedCallback() {
    this.io?.disconnect();
    this.sticky?.remove();
  }

  /* ---------------- Datos derivados ---------------- */

  get variant() {
    return this.data.variants.find((v) => v.id === this.state.variantId) || this.data.variants[0];
  }

  get isSub() {
    return this.state.type === 'subscription';
  }

  get plan() {
    const plans = this.variant.plans;
    return plans.find((p) => p.id === this.state.planId) || plans[0] || null;
  }

  /** Plan equivalente para otro producto: mismo ID (mismo grupo) o mismo nombre. */
  matchPlan(plans, ref) {
    if (!ref || !plans?.length) return null;
    return plans.find((p) => p.id === ref.id) || plans.find((p) => p.name === ref.name) || null;
  }

  refPrice(v) {
    return Math.max(v.price, v.compare || 0);
  }

  format(cents) {
    return this.money.format((cents || 0) / 100);
  }

  /* ---------------- Eventos ---------------- */

  onChange(e) {
    const t = e.target;
    if (t.matches('[data-pc-type]')) {
      this.state.type = t.value;
      window.pcTrack?.('pc_purchase_option_selected', {
        option: t.value,
        product_id: String(this.data.productId),
        source_section: this.closest('.shopify-section')?.id.replace('shopify-section-', '') || null
      });
    } else if (t.matches('[data-pc-variant]')) {
      const prev = this.plan;
      this.state.variantId = Number(t.value);
      this.state.planId = this.matchPlan(this.variant.plans, prev)?.id ?? null;
      this.syncUrl();
    } else if (t.matches('[data-pc-plan]')) {
      this.state.planId = Number(t.value);
    } else if (t.matches('[data-pc-qty]')) {
      this.state.qty = clampQty(t.value);
    } else {
      return;
    }
    this.render();
  }

  onClick(e) {
    const btn = e.target.closest('button');
    if (!btn || !this.contains(btn)) return;

    if (btn.matches('[data-pc-add]')) {
      this.add();
    } else if (btn.dataset.pcQtyStep) {
      this.state.qty = clampQty(this.state.qty + Number(btn.dataset.pcQtyStep));
      this.render();
    } else if (btn.dataset.pcExtraStep) {
      const id = Number(btn.closest('[data-pc-extra]').dataset.pcExtra);
      this.state.extras[id] = Math.max(0, Math.min(99, (this.state.extras[id] || 0) + Number(btn.dataset.pcExtraStep)));
      this.render();
    }
  }

  syncUrl() {
    if (!this.data.updateUrl) return;
    const url = new URL(window.location.href);
    url.searchParams.set('variant', this.state.variantId);
    history.replaceState(history.state, '', url);
  }

  /* ---------------- Render ---------------- */

  render() {
    const d = this.data;
    const v = this.variant;
    const hasPlans = v.plans.length > 0;

    if (!hasPlans) this.state.type = 'onetime';
    if (d.requiresPlan && hasPlans) this.state.type = 'subscription';

    const plan = hasPlans ? this.plan : null;
    this.state.planId = plan?.id ?? null;
    const isSub = this.isSub;
    const ref = this.refPrice(v);
    const set = (sel, text, show = true) => {
      const el = this.$(sel);
      if (!el) return;
      if (text != null) el.textContent = text;
      el.hidden = !show;
    };

    /* Opciones */
    const subOpt = this.$('[data-pc-option="subscription"]');
    const otOpt = this.$('[data-pc-option="onetime"]');
    if (subOpt) subOpt.hidden = !hasPlans;
    if (otOpt) otOpt.hidden = Boolean(d.requiresPlan && hasPlans);
    this.querySelectorAll('[data-pc-option]').forEach((opt) => {
      const on = opt.dataset.pcOption === this.state.type;
      opt.classList.toggle('is-active', on);
      const radio = opt.querySelector('[data-pc-type]');
      if (radio) radio.checked = on;
    });

    /* Tarjeta suscripción */
    if (plan) {
      const pct = ref > plan.price ? Math.round(((ref - plan.price) / ref) * 100) : 0;
      set('[data-pc-sub-price]', this.format(plan.price));
      set('[data-pc-sub-compare]', this.format(ref), ref > plan.price);
      if (d.servings > 0) set('[data-pc-sub-per]', `${this.format(plan.price / d.servings)} / ${d.perLabel}`);
      const badge = d.badge || '';
      if (badge.includes('[percent]')) {
        set('[data-pc-badge]', badge.replace('[percent]', pct), pct > 0);
      }
      this.renderPlanSelect(v.plans, plan);
    }

    /* Tarjeta compra única */
    set('[data-pc-ot-price]', this.format(v.price));
    set('[data-pc-ot-compare]', this.format(v.compare), v.compare > v.price);
    if (d.servings > 0) set('[data-pc-ot-per]', `${this.format(v.price / d.servings)} / ${d.perLabel}`);

    /* Totales */
    const unit = isSub && plan ? plan.price : v.price;
    let total = unit * this.state.qty;
    let regular = ref * this.state.qty;
    let extraUnits = 0;

    this.querySelectorAll('[data-pc-extra]').forEach((row) => {
      const x = d.extras.find((e) => e.id === Number(row.dataset.pcExtra));
      if (!x) return;
      const xPlan = isSub ? this.matchPlan(x.plans, plan) : null;
      const xUnit = xPlan ? xPlan.price : x.price;
      const q = this.state.extras[x.id] || 0;
      total += xUnit * q;
      regular += this.refPrice(x) * q;
      extraUnits += q;
      row.querySelector('[data-pc-extra-price]').textContent = this.format(xUnit);
      row.querySelector('[data-pc-extra-qty]').textContent = q;
      row.querySelector('[data-pc-extra-step="-1"]').disabled = q === 0;
      row.classList.toggle('is-selected', q > 0);
    });

    /* Cantidad */
    const qtyInput = this.$('[data-pc-qty]');
    if (qtyInput) qtyInput.value = this.state.qty;
    const minus = this.$('[data-pc-qty-step="-1"]');
    if (minus) minus.disabled = this.state.qty <= 1;

    /* Botón */
    const available = v.available;
    if (this.addButton && !this.busy) {
      this.addButton.disabled = !available;
      this.$('[data-pc-add-label]').textContent = available ? `${d.atcText} · ${this.format(total)}` : d.texts.soldOut;
    }

    const savings = regular - total;
    set('[data-pc-savings]', `${d.texts.save} ${this.format(savings)}`, available && savings > 0);

    /* Pago acelerado: solo compra única, un producto */
    const dynamic = this.$('[data-pc-dynamic]');
    if (dynamic) dynamic.hidden = isSub || extraUnits > 0 || !available;
    const formVariant = this.$('[data-pc-form-variant]');
    if (formVariant) formVariant.value = v.id;
    const formQty = this.$('[data-pc-form-qty]');
    if (formQty) formQty.value = this.state.qty;

    /* Sticky */
    if (this.sticky) {
      this.sticky.querySelector('[data-pc-sticky-price]').textContent = this.format(total);
      this.sticky.querySelector('[data-pc-sticky-add]').disabled = !available || this.busy;
    }
  }

  renderPlanSelect(plans, plan) {
    const select = this.$('[data-pc-plan]');
    const wrap = this.$('[data-pc-plan-wrap]');
    if (!select) return;
    const key = plans.map((p) => p.id).join(',');
    if (select.dataset.key !== key) {
      select.replaceChildren(...plans.map((p) => new Option(p.name, p.id)));
      select.dataset.key = key;
    }
    select.value = String(plan.id);
    if (wrap) wrap.hidden = plans.length < 2;
  }

  /* ---------------- Carrito ---------------- */

  buildItems() {
    const plan = this.isSub ? this.plan : null;
    const items = [{ id: this.variant.id, quantity: this.state.qty, ...(plan ? { selling_plan: plan.id } : {}) }];

    for (const x of this.data.extras || []) {
      const q = this.state.extras[x.id] || 0;
      if (q <= 0) continue;
      const xPlan = plan ? this.matchPlan(x.plans, plan) : null;
      items.push({ id: x.id, quantity: q, ...(xPlan ? { selling_plan: xPlan.id } : {}) });
    }
    return items;
  }

  cartSectionIds() {
    return [...document.querySelectorAll('cart-items-component')].map((c) => c.dataset.sectionId).filter(Boolean);
  }

  setBusy(busy) {
    this.busy = busy;
    if (!this.addButton) return;
    this.addButton.disabled = busy || !this.variant.available;
    this.addButton.classList.toggle('is-loading', busy);
    this.addButton.setAttribute('aria-busy', String(busy));
    if (busy) this.$('[data-pc-add-label]').textContent = this.data.texts.adding;
    const stickyBtn = this.sticky?.querySelector('[data-pc-sticky-add]');
    if (stickyBtn) stickyBtn.disabled = busy || !this.variant.available;
  }

  showError(message) {
    const el = this.$('[data-pc-error]');
    if (!el) return;
    el.textContent = message || '';
    el.hidden = !message;
  }

  async add() {
    if (this.busy || !this.variant.available) return;
    const { routes, texts } = this.data;
    const items = this.buildItems();
    const units = items.reduce((n, i) => n + i.quantity, 0);
    const sectionIds = this.cartSectionIds();

    this.showError('');
    this.setBusy(true);

    try {
      const res = await fetch(routes.add, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          items,
          ...(sectionIds.length ? { sections: sectionIds.join(','), sections_url: window.location.pathname } : {})
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.description || json.message || texts.error);

      let sections = json.sections;
      if (!this.isSub && this.data.codes.length) {
        sections = (await this.applyCodes(sectionIds)) || sections;
      }

      await this.announce(sections, units);
      this.afterAdd();
    } catch (err) {
      console.error('[pc-buy-box]', err);
      this.showError(err.message || texts.error);
    } finally {
      this.setBusy(false);
      this.render();
    }
  }

  /**
   * /cart/update.js con `discount` REEMPLAZA los códigos del carrito:
   * se fusiona con los existentes para no borrar cupones del cliente.
   */
  async applyCodes(sectionIds) {
    const { routes, codes } = this.data;
    try {
      const cart = await fetch(routes.cart, { headers: { Accept: 'application/json' } }).then((r) => r.json());
      const merged = new Map((cart.discount_codes || []).map((c) => [String(c.code).toUpperCase(), c.code]));
      codes.forEach((c) => merged.set(c.toUpperCase(), c));

      const res = await fetch(routes.update, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          discount: [...merged.values()].join(','),
          ...(sectionIds.length ? { sections: sectionIds.join(','), sections_url: window.location.pathname } : {})
        })
      });
      if (!res.ok) return null;
      const updated = await res.json();
      const applied = new Set(
        (updated.discount_codes || []).filter((c) => c.applicable).map((c) => String(c.code).toUpperCase())
      );
      codes
        .filter((c) => !applied.has(c.toUpperCase()))
        .forEach((c) => console.warn(`[pc-buy-box] El código ${c} no aplica (revisa Combinations / Purchase type).`));
      return updated.sections || null;
    } catch (err) {
      console.warn('[pc-buy-box] No se pudo aplicar el código', err);
      return null;
    }
  }

  async announce(sections, units) {
    const data = { source: 'pc-buy-box', itemCount: units, sections, didError: false };
    const mod = await themeEvents;
    const event = mod?.CartAddEvent
      ? new mod.CartAddEvent({}, this.id, data)
      : new CustomEvent('cart:update', { bubbles: true, detail: { resource: {}, sourceId: this.id, data } });
    this.dispatchEvent(event);

    if (!this.data.openDrawer) return;
    const drawer = document.querySelector('cart-drawer-component');
    if (!drawer) {
      window.location.href = this.data.routes.cartPage;
      return;
    }
    const isOpen = drawer.hasAttribute('open') || drawer.querySelector('dialog[open]');
    if (!isOpen) (drawer.open || drawer.showDialog)?.call(drawer);
  }

  afterAdd() {
    this.state.qty = 1;
    Object.keys(this.state.extras).forEach((id) => (this.state.extras[id] = 0));
    if (!this.data.openDrawer) {
      const label = this.$('[data-pc-add-label]');
      this.render();
      label.textContent = this.data.texts.added;
      setTimeout(() => this.render(), 1800);
    }
  }

  /* ---------------- Sticky móvil ---------------- */

  attachSticky() {
    if (!this.sticky) {
      this.sticky = this.querySelector('[data-pc-sticky]');
      if (!this.sticky) return;
      this.sticky.querySelector('[data-pc-sticky-add]').addEventListener('click', () => this.add());
    }
    if (!this.addButton || !('IntersectionObserver' in window)) return;

    // Se mueve a <body> para que ningún ancestro con transform/overflow rompa el position:fixed.
    document.body.append(this.sticky);
    this.sticky.inert = true;
    this.io = new IntersectionObserver(([entry]) => {
      const show = !entry.isIntersecting && entry.boundingClientRect.top < 0;
      this.sticky.classList.toggle('is-visible', show);
      this.sticky.inert = !show;
    });
    this.io.observe(this.addButton);
  }
}

if (!customElements.get('pc-buy-box')) customElements.define('pc-buy-box', PcBuyBox);

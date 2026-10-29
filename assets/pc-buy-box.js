/**
 * <pc-buy-box> — selector de compra en 2 pasos (sabor → plan).
 * Markup y datos: snippets/pc-buy-box.liquid.
 *
 * - Listeners delegados en el constructor: sobrevive a re-renders del editor
 *   y al morph de Horizon sin duplicar handlers.
 * - En el PDP (data.navigate) cambiar de sabor va a la página de ese producto
 *   conservando el plan (?purchase=). Fuera del PDP cambia en el mismo lugar.
 * - Integra con Horizon vía CartAddEvent de '@theme/events'.
 */

const themeEvents = import('@theme/events').catch(() => null);
const clampQty = (n) => Math.max(1, Math.min(99, Number.parseInt(n, 10) || 1));

class PcBuyBox extends HTMLElement {
  constructor() {
    super();
    this.busy = false;
    this.addEventListener('change', (e) => this.onChange(e));
    this.addEventListener('click', (e) => this.onClick(e));
    // Al volver con "atrás" el navegador restaura la página tal cual: se deshace el feedback de navegación.
    window.addEventListener('pageshow', (e) => {
      if (!e.persisted || !this.data) return;
      this.removeAttribute('aria-busy');
      this.render();
    });
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

    if (!this.state) {
      const asked = new URLSearchParams(window.location.search).get('purchase');
      this.state = {
        flavor: d.selected,
        type: asked === 'subscription' || asked === 'onetime' ? asked : d.type,
        planId: d.planId,
        qty: 1
      };
    }

    this.$ = (sel) => this.querySelector(sel);
    this.addButton = this.$('[data-pc-add]');
    this.attachSticky();
    this.render();
  }

  disconnectedCallback() {
    this.io?.disconnect();
    this.sticky?.remove();
  }

  get flavor() {
    return this.data.flavors[this.state.flavor];
  }

  get isSub() {
    return this.state.type === 'subscription';
  }

  get plan() {
    const plans = this.flavor.plans;
    return plans.find((p) => p.id === this.state.planId) || plans[0] || null;
  }

  format(cents) {
    return this.money.format((cents || 0) / 100);
  }

  go(url) {
    window.location.href = url;
  }

  /* ---------------- Eventos ---------------- */

  onChange(e) {
    const t = e.target;
    if (t.matches('[data-pc-flavor]')) {
      const index = Number(t.value);
      if (this.data.navigate && index !== this.data.selected) {
        // Feedback inmediato mientras carga la página del otro sabor.
        this.querySelectorAll('[data-pc-flavor]').forEach((r) => r.closest('.pc-bb__flavor')?.classList.toggle('is-active', r === t));
        this.setAttribute('aria-busy', 'true');
        // Conserva los parámetros actuales (?view= de prueba, preview_theme_id, utm_*), salvo la variante.
        const url = new URL(this.data.flavors[index].url, window.location.origin);
        new URLSearchParams(window.location.search).forEach((value, key) => {
          if (key !== 'variant') url.searchParams.set(key, value);
        });
        url.searchParams.set('purchase', this.state.type);
        this.go(url.toString());
        return;
      }
      const prev = this.plan;
      this.state.flavor = index;
      const plans = this.flavor.plans;
      this.state.planId = (prev && (plans.find((p) => p.id === prev.id) || plans.find((p) => p.name === prev.name)))?.id ?? null;
    } else if (t.matches('[data-pc-type]')) {
      this.state.type = t.value;
      window.pcTrack?.('pc_purchase_option_selected', {
        option: t.value,
        product_id: String(this.flavor.productId),
        source_section: this.closest('.shopify-section')?.id.replace('shopify-section-', '') || null
      });
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
    }
  }

  /* ---------------- Render ---------------- */

  render() {
    const d = this.data;
    const f = this.flavor;
    const hasPlans = f.plans.length > 0;
    if (!hasPlans) this.state.type = 'onetime';
    if (f.requiresPlan && hasPlans) this.state.type = 'subscription';

    const plan = hasPlans ? this.plan : null;
    this.state.planId = plan?.id ?? null;
    const isSub = this.isSub;
    const ref = Math.max(f.price, f.compare || 0);
    const set = (sel, text, show = true) => {
      const el = this.$(sel);
      if (!el) return;
      if (text != null) el.textContent = text;
      el.hidden = !show;
    };
    const perServing = (cents) => (f.servings > 0 ? `${this.format(cents / f.servings)} per ${d.perLabel}` : '');

    /* Paso 1: sabor */
    this.querySelectorAll('[data-pc-flavor]').forEach((radio) => {
      const on = Number(radio.value) === this.state.flavor;
      radio.checked = on;
      radio.closest('.pc-bb__flavor')?.classList.toggle('is-active', on);
    });
    set('[data-pc-flavor-title]', f.title);
    set('[data-pc-flavor-nutrition]', f.nutrition, Boolean(f.nutrition));

    /* Paso 2: plan */
    const subOpt = this.$('[data-pc-option="subscription"]');
    const otOpt = this.$('[data-pc-option="onetime"]');
    if (subOpt) subOpt.hidden = !hasPlans;
    if (otOpt) otOpt.hidden = Boolean(f.requiresPlan && hasPlans);
    this.querySelectorAll('[data-pc-option]').forEach((opt) => {
      const on = opt.dataset.pcOption === this.state.type;
      opt.classList.toggle('is-active', on);
      const radio = opt.querySelector('[data-pc-type]');
      if (radio) radio.checked = on;
    });

    if (plan) {
      const pct = ref > plan.price ? Math.round(((ref - plan.price) / ref) * 100) : 0;
      set('[data-pc-sub-price]', this.format(plan.price));
      set('[data-pc-sub-compare]', this.format(ref), ref > plan.price);
      set('[data-pc-frequency]', plan.name.split(',')[0].trim());
      set('[data-pc-sub-per]', perServing(plan.price), f.servings > 0);
      if ((d.badge || '').includes('[percent]')) set('[data-pc-badge]', d.badge.replace('[percent]', pct), pct > 0);
      this.renderPlanSelect(f.plans, plan);
    }
    set('[data-pc-ot-price]', this.format(f.price));
    set('[data-pc-ot-compare]', this.format(f.compare), f.compare > f.price);
    set('[data-pc-ot-per]', perServing(f.price), f.servings > 0);

    /* Totales y botón */
    const unit = isSub && plan ? plan.price : f.price;
    const total = unit * this.state.qty;
    const savings = (ref - unit) * this.state.qty;

    const qtyInput = this.$('[data-pc-qty]');
    if (qtyInput) qtyInput.value = this.state.qty;
    const minus = this.$('[data-pc-qty-step="-1"]');
    if (minus) minus.disabled = this.state.qty <= 1;

    if (this.addButton && !this.busy) {
      this.addButton.disabled = !f.available;
      set('[data-pc-add-label]', f.available ? d.atcText : d.texts.soldOut);
      set('[data-pc-add-price]', this.format(total), f.available);
    }
    set('[data-pc-savings]', `${d.texts.save} ${this.format(savings)}`, f.available && isSub && savings > 0);
    const note = d.notes[this.state.type] || '';
    set('[data-pc-note]', note, Boolean(note));

    /* Pago rápido: solo compra única del producto con el que cargó la página */
    const dynamic = this.$('[data-pc-dynamic]');
    if (dynamic) dynamic.hidden = isSub || !f.available || this.state.flavor !== d.selected;
    const formQty = this.$('[data-pc-form-qty]');
    if (formQty) formQty.value = this.state.qty;

    if (this.sticky) {
      this.sticky.querySelector('[data-pc-sticky-title]').textContent = f.short;
      this.sticky.querySelector('[data-pc-sticky-price]').textContent = this.format(total);
      this.sticky.querySelector('[data-pc-sticky-add]').disabled = !f.available || this.busy;
    }
  }

  renderPlanSelect(plans, plan) {
    const select = this.$('[data-pc-plan]');
    if (!select) return;
    const key = plans.map((p) => p.id).join(',');
    if (select.dataset.key !== key) {
      select.replaceChildren(...plans.map((p) => new Option(p.name, p.id)));
      select.dataset.key = key;
    }
    select.value = String(plan.id);
    const wrap = this.$('[data-pc-plan-wrap]');
    if (wrap) wrap.hidden = plans.length < 2;
  }

  /* ---------------- Carrito ---------------- */

  setBusy(busy) {
    this.busy = busy;
    const available = this.flavor.available;
    if (this.addButton) {
      this.addButton.disabled = busy || !available;
      this.addButton.setAttribute('aria-busy', String(busy));
      if (busy) this.$('[data-pc-add-label]').textContent = this.data.texts.adding;
    }
    const stickyBtn = this.sticky?.querySelector('[data-pc-sticky-add]');
    if (stickyBtn) stickyBtn.disabled = busy || !available;
  }

  showError(message) {
    const el = this.$('[data-pc-error]');
    if (!el) return;
    el.textContent = message || '';
    el.hidden = !message;
  }

  async add() {
    const f = this.flavor;
    if (this.busy || !f.available) return;
    const { routes, texts } = this.data;
    const plan = this.isSub ? this.plan : null;
    const item = { id: f.variantId, quantity: this.state.qty, ...(plan ? { selling_plan: plan.id } : {}) };
    const sectionIds = [...document.querySelectorAll('cart-items-component')].map((c) => c.dataset.sectionId).filter(Boolean);
    const sectionsParams = sectionIds.length ? { sections: sectionIds.join(','), sections_url: window.location.pathname } : {};

    this.showError('');
    this.setBusy(true);
    try {
      const res = await fetch(routes.add, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items: [item], ...sectionsParams })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.description || json.message || texts.error);

      let sections = json.sections;
      if (!plan && this.data.codes.length) sections = (await this.applyCodes(sectionsParams)) || sections;

      await this.announce(sections, item.quantity);
      this.state.qty = 1;
    } catch (err) {
      console.error('[pc-buy-box]', err);
      this.showError(err.message || texts.error);
    } finally {
      this.setBusy(false);
      this.render();
    }
  }

  /** /cart/update.js con `discount` REEMPLAZA los códigos: se fusiona con los del cliente. */
  async applyCodes(sectionsParams) {
    const { routes, codes } = this.data;
    try {
      const cart = await fetch(routes.cart, { headers: { Accept: 'application/json' } }).then((r) => r.json());
      const merged = new Map((cart.discount_codes || []).map((c) => [String(c.code).toUpperCase(), c.code]));
      codes.forEach((c) => merged.set(c.toUpperCase(), c));
      const res = await fetch(routes.update, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ discount: [...merged.values()].join(','), ...sectionsParams })
      });
      if (!res.ok) return null;
      const updated = await res.json();
      const applied = new Set((updated.discount_codes || []).filter((c) => c.applicable).map((c) => String(c.code).toUpperCase()));
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
    this.dispatchEvent(
      mod?.CartAddEvent
        ? new mod.CartAddEvent({}, this.id, data)
        : new CustomEvent('cart:update', { bubbles: true, detail: { resource: {}, sourceId: this.id, data } })
    );

    if (!this.data.openDrawer) return;
    const drawer = document.querySelector('cart-drawer-component');
    if (!drawer) return this.go(this.data.routes.cartPage);
    const isOpen = drawer.hasAttribute('open') || drawer.querySelector('dialog[open]');
    if (!isOpen) (drawer.open || drawer.showDialog)?.call(drawer);
  }

  /* ---------------- Sticky móvil ---------------- */

  attachSticky() {
    if (!this.sticky) {
      this.sticky = this.querySelector('[data-pc-sticky]');
      if (!this.sticky) return;
      this.sticky.querySelector('[data-pc-sticky-add]').addEventListener('click', () => this.add());
    }
    if (!this.addButton || !('IntersectionObserver' in window)) return;
    // A <body> para que ningún ancestro con transform/overflow rompa el position:fixed.
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

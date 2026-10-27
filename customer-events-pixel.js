/* ==================================================================
   Pronto Chocho — Custom Pixel (conversión + funnel de checkout)
   ------------------------------------------------------------------
   Dónde: Admin → Settings → Customer events → Add custom pixel → pegar.
   Privacidad: Permission "Required" · Data sale "Analytics"
              (ajustar a la política de consentimiento de la tienda).

   Envía a GA4 con nombres prefijados "pc_" para NO duplicar los eventos
   que ya mande la app Google & YouTube, si está instalada.

   Fuentes:
   - Eventos estándar de Shopify (checkout paso a paso + alertas).
   - Eventos custom publicados por snippets/pc-analytics.liquid.
   ================================================================== */

const GA4_ID = 'G-XXXXXXXXXX'; // ← reemplazar por el Measurement ID real
const SEND_PAGE_VIEWS = true; // false si esta misma propiedad ya recibe page_view de otra integración
const DEBUG = false; // true = log en consola + debug_mode en GA4 (DebugView)

/* ---------- gtag dentro del sandbox del pixel ---------- */
const gtagScript = document.createElement('script');
gtagScript.async = true;
gtagScript.src = `https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`;
document.head.appendChild(gtagScript);

window.dataLayer = window.dataLayer || [];
function gtag() {
  window.dataLayer.push(arguments);
}
gtag('js', new Date());
gtag('config', GA4_ID, { send_page_view: false });

const send = (name, params, event) => {
  const loc = event?.context?.document?.location;
  const payload = {
    ...params,
    page_location: loc?.href,
    page_path: loc?.pathname,
    ...(DEBUG ? { debug_mode: true } : {})
  };
  if (DEBUG) console.log('[pc-pixel]', name, payload);
  gtag('event', name, payload);
};

/* GA4 solo acepta valores escalares en parámetros de eventos custom */
const flatten = (data = {}) => {
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    if (value == null) continue;
    if (key === 'items' && Array.isArray(value)) {
      out.variant_ids = value.map((i) => i.variant_id).join(',');
      continue;
    }
    if (key === 'codes' && Array.isArray(value)) {
      out.discount_codes = value.map((c) => `${c.code}:${c.applicable ? 'ok' : 'rejected'}`).join(',');
      continue;
    }
    if (['string', 'number', 'boolean'].includes(typeof value)) out[key] = value;
  }
  return out;
};

/* ---------- Resumen del checkout (sin datos personales) ---------- */
const checkoutParams = (c = {}) => {
  const lines = c.lineItems || [];
  const codes = (c.discountApplications || []).filter((d) => d.type === 'DISCOUNT_CODE').map((d) => d.title);
  return {
    currency: c.currencyCode,
    value: Number(c.totalPrice?.amount ?? c.subtotalPrice?.amount ?? 0),
    units: lines.reduce((n, l) => n + (l.quantity || 0), 0),
    has_subscription: lines.some((l) => l.sellingPlanAllocation) ? 'yes' : 'no',
    discount_codes: codes.join(',') || 'none',
    shipping_cost: c.shippingLine?.price?.amount ?? undefined,
    country: c.shippingAddress?.countryCode ?? undefined,
    province: c.shippingAddress?.provinceCode ?? undefined
  };
};

/* ---------- Navegación ---------- */
analytics.subscribe('page_viewed', (e) => {
  if (SEND_PAGE_VIEWS) send('page_view', { page_title: e.context?.document?.title }, e);
});

analytics.subscribe('product_viewed', (e) => {
  const v = e.data?.productVariant || {};
  send(
    'pc_product_viewed',
    {
      product_id: v.product?.id,
      product_title: v.product?.title,
      variant_id: v.id,
      price: v.price?.amount
    },
    e
  );
});

/* ---------- Funnel de checkout, paso a paso ---------- */
const CHECKOUT_STEPS = {
  checkout_started: 'pc_checkout_started',
  checkout_contact_info_submitted: 'pc_checkout_contact',
  checkout_address_info_submitted: 'pc_checkout_address',
  checkout_shipping_info_submitted: 'pc_checkout_shipping',
  payment_info_submitted: 'pc_checkout_payment',
  checkout_completed: 'pc_checkout_completed'
};

Object.entries(CHECKOUT_STEPS).forEach(([shopifyEvent, gaEvent]) => {
  analytics.subscribe(shopifyEvent, (e) => send(gaEvent, checkoutParams(e.data?.checkout), e));
});

/* Errores visibles en el checkout: dirección inválida, pago rechazado,
   código no aplicable, sin tarifas de envío, etc. */
analytics.subscribe('alert_displayed', (e) => {
  const a = e.data?.alert || {};
  send(
    'pc_checkout_alert',
    {
      alert_type: a.type,
      alert_target: a.target,
      alert_message: String(a.value || '').slice(0, 100)
    },
    e
  );
});

analytics.subscribe('ui_extension_errored', (e) => {
  const err = e.data?.error || {};
  send('pc_checkout_extension_error', { extension: err.extensionName || 'unknown', app: err.appName || 'unknown' }, e);
});

/* ---------- Eventos custom del theme (pc-analytics.liquid) ---------- */
[
  'pc_add_to_cart',
  'pc_add_to_cart_error',
  'pc_discount_attempt',
  'pc_checkout_cta_click',
  'pc_purchase_option_selected'
].forEach((name) => {
  analytics.subscribe(name, (e) => send(name, flatten(e.customData), e));
});

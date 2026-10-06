// Материя 2.0.0 — вендорено scripts/sync-materia.mjs из D:/dev/materia. Руками не править.
// src/materia.mjs
import * as React from "react";
var h = React.createElement;
function cx() {
  var out = [];
  for (var i = 0; i < arguments.length; i++) if (arguments[i]) out.push(arguments[i]);
  return out.join(" ");
}
function omit(obj, keys) {
  var out = {};
  for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k) && keys.indexOf(k) === -1) out[k] = obj[k];
  return out;
}
function pad2(n) {
  var s = String(n);
  return s.length < 2 ? "0" + s : s;
}
var PATHS = {
  "arrow-right": [["path", { d: "M5 12h14" }], ["path", { d: "m12 5 7 7-7 7" }]],
  "arrow-up-right": [["path", { d: "M7 7h10v10" }], ["path", { d: "M7 17 17 7" }]],
  "check": [["path", { d: "M20 6 9 17l-5-5" }]],
  "x": [["path", { d: "M18 6 6 18" }], ["path", { d: "m6 6 12 12" }]],
  "plus": [["path", { d: "M5 12h14" }], ["path", { d: "M12 5v14" }]],
  "info": [["circle", { cx: 12, cy: 12, r: 10 }], ["path", { d: "M12 16v-4" }], ["path", { d: "M12 8h.01" }]],
  "check-circle": [["circle", { cx: 12, cy: 12, r: 10 }], ["path", { d: "m9 12 2 2 4-4" }]],
  "alert-circle": [["circle", { cx: 12, cy: 12, r: 10 }], ["path", { d: "M12 8v4" }], ["path", { d: "M12 16h.01" }]],
  "alert-triangle": [["path", { d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" }], ["path", { d: "M12 9v4" }], ["path", { d: "M12 17h.01" }]],
  "trending-up": [["path", { d: "M22 7 13.5 15.5 8.5 10.5 2 17" }], ["path", { d: "M16 7h6v6" }]],
  "trending-down": [["path", { d: "M22 17 13.5 8.5 8.5 13.5 2 7" }], ["path", { d: "M16 17h6v-6" }]],
  "play": [["path", { d: "M6 4v16l14-8Z" }]],
  "download": [["path", { d: "M12 15V3" }], ["path", { d: "m7 10 5 5 5-5" }], ["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }]],
  "search": [["circle", { cx: 11, cy: 11, r: 8 }], ["path", { d: "m21 21-4.3-4.3" }]],
  "clock": [["circle", { cx: 12, cy: 12, r: 10 }], ["path", { d: "M12 6v6l4 2" }]],
  "layers": [["path", { d: "m12 2 10 5-10 5L2 7Z" }], ["path", { d: "m2 17 10 5 10-5" }], ["path", { d: "m2 12 10 5 10-5" }]],
  "shield": [["path", { d: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" }]],
  "zap": [["path", { d: "M13 2 3 14h9l-1 8 10-12h-9Z" }]],
  "arrow-left": [["path", { d: "m12 19-7-7 7-7" }], ["path", { d: "M19 12H5" }]],
  "chevron-down": [["path", { d: "m6 9 6 6 6-6" }]],
  "chevron-up": [["path", { d: "m18 15-6-6-6 6" }]],
  "chevron-left": [["path", { d: "m15 18-6-6 6-6" }]],
  "chevron-right": [["path", { d: "m9 18 6-6-6-6" }]],
  "menu": [["path", { d: "M4 6h16" }], ["path", { d: "M4 12h16" }], ["path", { d: "M4 18h16" }]],
  "more-horizontal": [["circle", { cx: 5, cy: 12, r: 1 }], ["circle", { cx: 12, cy: 12, r: 1 }], ["circle", { cx: 19, cy: 12, r: 1 }]],
  "minus": [["path", { d: "M5 12h14" }]],
  "inbox": [["path", { d: "M22 12h-6l-2 3h-4l-2-3H2" }], ["path", { d: "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" }]],
  "search-x": [["circle", { cx: 11, cy: 11, r: 8 }], ["path", { d: "m21 21-4.3-4.3" }], ["path", { d: "m13.5 8.5-5 5" }], ["path", { d: "m8.5 8.5 5 5" }]],
  "user": [["circle", { cx: 12, cy: 8, r: 5 }], ["path", { d: "M20 21a8 8 0 0 0-16 0" }]],
  "mail": [["rect", { x: 2, y: 4, width: 20, height: 16, rx: 2 }], ["path", { d: "m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" }]],
  "map-pin": [["path", { d: "M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" }], ["circle", { cx: 12, cy: 10, r: 3 }]],
  "calendar": [["rect", { x: 3, y: 4, width: 18, height: 18, rx: 2 }], ["path", { d: "M16 2v4" }], ["path", { d: "M8 2v4" }], ["path", { d: "M3 10h18" }]],
  "truck": [["path", { d: "M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" }], ["path", { d: "M15 18H9" }], ["path", { d: "M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14" }], ["circle", { cx: 17, cy: 18, r: 2 }], ["circle", { cx: 7, cy: 18, r: 2 }]],
  "rotate-ccw": [["path", { d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" }], ["path", { d: "M3 3v5h5" }]],
  "shield-check": [["path", { d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" }], ["path", { d: "m9 12 2 2 4-4" }]],
  "credit-card": [["rect", { x: 2, y: 5, width: 20, height: 14, rx: 2 }], ["path", { d: "M2 10h20" }]],
  "bell": [["path", { d: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" }], ["path", { d: "M10.3 21a1.94 1.94 0 0 0 3.4 0" }]],
  "external-link": [["path", { d: "M15 3h6v6" }], ["path", { d: "M10 14 21 3" }], ["path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" }]],
  "pencil": [["path", { d: "M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z" }], ["path", { d: "m15 5 4 4" }]],
  "copy": [["rect", { x: 8, y: 8, width: 14, height: 14, rx: 2 }], ["path", { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" }]],
  "trash": [["path", { d: "M3 6h18" }], ["path", { d: "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" }], ["path", { d: "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" }]],
  "log-out": [["path", { d: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" }], ["path", { d: "m16 17 5-5-5-5" }], ["path", { d: "M21 12H9" }]],
  "filter": [["path", { d: "M22 3H2l8 9.46V19l4 2v-8.54L22 3z" }]],
  "refresh-cw": [["path", { d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" }], ["path", { d: "M21 3v5h-5" }], ["path", { d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" }], ["path", { d: "M8 16H3v5" }]],
  "sliders": [["path", { d: "M21 4h-7" }], ["path", { d: "M10 4H3" }], ["path", { d: "M21 12h-9" }], ["path", { d: "M8 12H3" }], ["path", { d: "M21 20h-5" }], ["path", { d: "M12 20H3" }], ["path", { d: "M14 2v4" }], ["path", { d: "M8 10v4" }], ["path", { d: "M16 18v4" }]],
  "upload": [["path", { d: "M12 3v12" }], ["path", { d: "m17 8-5-5-5 5" }], ["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }]],
  "eye": [["path", { d: "M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" }], ["circle", { cx: 12, cy: 12, r: 3 }]],
  "globe": [["circle", { cx: 12, cy: 12, r: 10 }], ["path", { d: "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" }], ["path", { d: "M2 12h20" }]],
  "file": [["path", { d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" }], ["path", { d: "M14 2v4a2 2 0 0 0 2 2h4" }]],
  "send": [["path", { d: "m22 2-7 20-4-9-9-4Z" }], ["path", { d: "M22 2 11 13" }]]
};
function Icon(props) {
  var size = props.size || 16;
  var parts = PATHS[props.name] || [];
  return h("svg", {
    className: cx("m-icon", props.className),
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    style: props.strokeWidth ? { strokeWidth: props.strokeWidth } : void 0,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    role: props.label ? "img" : void 0,
    "aria-label": props.label,
    "aria-hidden": props.label ? void 0 : "true",
    focusable: "false"
  }, parts.map(function(p, i) {
    return h(p[0], Object.assign({ key: i }, p[1]));
  }));
}
Icon.names = Object.keys(PATHS);
function Button(props) {
  var variant = props.variant || "secondary";
  var size = props.size || "md";
  var iconSize = size === "lg" ? 18 : 16;
  var rest = omit(props, ["variant", "size", "icon", "iconAfter", "href", "children", "className", "type"]);
  var cls = cx("m-btn", "m-btn--" + variant, "m-btn--" + size, props.className);
  var kids = [
    props.icon ? h(Icon, { key: "i", name: props.icon, size: iconSize }) : null,
    props.children != null ? h("span", { key: "l", className: "m-btn-label" }, props.children) : null,
    props.iconAfter ? h(Icon, { key: "a", name: props.iconAfter, size: iconSize, className: "m-btn-after" }) : null
  ];
  if (props.href) return h("a", Object.assign({ className: cls, href: props.href }, rest), kids);
  return h("button", Object.assign({ className: cls, type: props.type || "button" }, rest), kids);
}
function Badge(props) {
  var tone = props.tone || "neutral";
  return h(
    "span",
    { className: cx("m-badge", "m-badge--" + tone, props.className) },
    props.dot ? h("span", { className: "m-badge-dot", "aria-hidden": "true" }) : null,
    props.children
  );
}
var fieldSeq = 0;
function Field(props) {
  var auto = React.useState(function() {
    fieldSeq += 1;
    return "m-field-" + fieldSeq;
  })[0];
  var id = props.id || auto;
  var msg = props.error || props.hint;
  var msgId = msg ? id + "-msg" : void 0;
  var rest = omit(props, ["label", "hint", "error", "id", "multiline", "prefix", "suffix", "className"]);
  var control = h(props.multiline ? "textarea" : "input", Object.assign({
    id,
    className: "m-field-control",
    "aria-invalid": props.error ? "true" : void 0,
    "aria-describedby": msgId
  }, rest));
  return h(
    "div",
    { className: cx("m-field", props.error && "m-field--error", props.multiline && "m-field--multiline", props.className) },
    props.label ? h("label", { className: "m-field-label", htmlFor: id }, props.label) : null,
    h(
      "div",
      { className: "m-field-box" },
      props.prefix ? h("span", { className: "m-field-affix" }, props.prefix) : null,
      control,
      props.suffix ? h("span", { className: "m-field-affix" }, props.suffix) : null
    ),
    msg ? h(
      "p",
      { id: msgId, className: "m-field-msg" },
      props.error ? h(Icon, { name: "alert-circle", size: 14 }) : null,
      h("span", null, msg)
    ) : null
  );
}
function Segmented(props) {
  var options = props.options || [];
  var initial = props.defaultValue !== void 0 ? props.defaultValue : options[0] && options[0].value;
  var state = React.useState(initial);
  var value = props.value !== void 0 ? props.value : state[0];
  function pick(v) {
    if (props.value === void 0) state[1](v);
    if (props.onChange) props.onChange(v);
  }
  return h(
    "div",
    { className: cx("m-seg", props.className), role: "group", "aria-label": props.label },
    options.map(function(o) {
      var on = o.value === value;
      return h("button", {
        key: o.value,
        type: "button",
        className: cx("m-seg-item", on && "is-on"),
        "aria-pressed": on ? "true" : "false",
        onClick: function() {
          pick(o.value);
        }
      }, o.label);
    })
  );
}
var NOTICE_ICON = { info: "info", positive: "check-circle", caution: "alert-triangle", critical: "alert-circle" };
function Notice(props) {
  var tone = props.tone || "info";
  return h(
    "div",
    { className: cx("m-notice", "m-notice--" + tone, props.className), role: tone === "critical" ? "alert" : "status" },
    h(Icon, { name: NOTICE_ICON[tone] || "info", size: 18, className: "m-notice-icon" }),
    h(
      "div",
      { className: "m-notice-body" },
      props.title ? h("p", { className: "m-notice-title" }, props.title) : null,
      props.children ? h("div", { className: "m-notice-text" }, props.children) : null
    ),
    props.action ? h("div", { className: "m-notice-action" }, props.action) : null
  );
}
function Card(props) {
  var variant = props.variant || "outline";
  var tag = props.href ? "a" : props.as || "div";
  var rest = omit(props, ["variant", "as", "href", "media", "children", "className", "padding"]);
  return h(
    tag,
    Object.assign({
      className: cx("m-card", "m-card--" + variant, props.href && "m-card--link", props.padding === "lg" && "m-card--lg", props.className),
      href: props.href
    }, rest),
    props.media ? h("div", { className: "m-card-media" }, props.media) : null,
    h("div", { className: "m-card-body" }, props.children)
  );
}
function Stat(props) {
  var delta = props.delta;
  var trend = props.trend || (typeof delta === "string" && /^[-−–]/.test(delta) ? "down" : "up");
  var good = props.good || "up";
  var tone = trend === good ? "positive" : "critical";
  return h(
    "div",
    { className: cx("m-stat", props.className) },
    h("p", { className: "m-stat-label" }, props.label),
    h(
      "p",
      { className: "m-stat-value" },
      h("span", { className: "m-stat-num" }, props.value),
      props.unit ? h("span", { className: "m-stat-unit" }, props.unit) : null
    ),
    delta ? h(
      "p",
      { className: cx("m-stat-delta", "m-stat-delta--" + tone) },
      h(Icon, { name: trend === "down" ? "trending-down" : "trending-up", size: 14 }),
      h("span", null, delta),
      props.deltaNote ? h("span", { className: "m-stat-delta-note" }, props.deltaNote) : null
    ) : null,
    props.note ? h("p", { className: "m-stat-note" }, props.note) : null
  );
}
function DataTable(props) {
  var cols = props.columns || [];
  var rows = props.rows || [];
  return h(
    "div",
    { className: cx("m-table-wrap", props.className) },
    h(
      "table",
      { className: "m-table" },
      props.caption ? h("caption", null, props.caption) : null,
      h("thead", null, h("tr", null, cols.map(function(c) {
        return h("th", { key: c.key, scope: "col", className: cx(c.numeric && "is-num") }, c.label);
      }))),
      h("tbody", null, rows.map(function(r, i) {
        return h("tr", { key: r.id != null ? r.id : i }, cols.map(function(c) {
          return h("td", { key: c.key, className: cx(c.numeric && "is-num") }, c.render ? c.render(r[c.key], r) : r[c.key]);
        }));
      }))
    )
  );
}
function Quote(props) {
  return h(
    "figure",
    { className: cx("m-quote", props.className) },
    h("blockquote", { className: "m-quote-text" }, props.children),
    props.author || props.role ? h(
      "figcaption",
      { className: "m-quote-by" },
      props.author ? h("span", { className: "m-quote-author" }, props.author) : null,
      props.role ? h("span", { className: "m-quote-role" }, props.role) : null
    ) : null
  );
}
function Hero(props) {
  var layout = props.layout || (props.media ? "split" : "stack");
  return h(
    "section",
    { className: cx("m-hero", "m-hero--" + layout, props.className) },
    h(
      "div",
      { className: "m-hero-copy" },
      props.eyebrow ? h("p", { className: "m-eyebrow" }, props.eyebrow) : null,
      h("h1", { className: "m-display m-hero-title" }, props.title),
      props.lede ? h("p", { className: "m-lede m-hero-lede" }, props.lede) : null,
      props.actions ? h("div", { className: "m-hero-actions" }, props.actions) : null,
      props.meta ? h("div", { className: "m-hero-meta" }, props.meta) : null
    ),
    props.media ? h("div", { className: "m-hero-media" }, props.media) : null
  );
}
function FeatureList(props) {
  var cols = props.columns || 3;
  var items = props.items || [];
  return h(
    props.ordered ? "ol" : "ul",
    { className: cx("m-features", "m-features--" + cols, props.className) },
    items.map(function(it, i) {
      return h(
        "li",
        { key: i, className: "m-feature" },
        props.ordered ? h("span", { className: "m-feature-step", "aria-hidden": "true" }, pad2(i + 1)) : it.icon ? h("span", { className: "m-feature-icon" }, h(Icon, { name: it.icon, size: 20 })) : null,
        h("h3", { className: "m-h3 m-feature-title" }, it.title),
        it.text ? h("p", { className: "m-feature-text" }, it.text) : null,
        it.meta ? h("p", { className: "m-feature-meta" }, it.meta) : null
      );
    })
  );
}
function PriceCard(props) {
  return h(
    "div",
    { className: cx("m-price", props.featured && "m-price--featured", props.className) },
    h(
      "div",
      { className: "m-price-head" },
      h("h3", { className: "m-h3 m-price-name" }, props.name),
      props.badge ? h(Badge, { tone: "accent" }, props.badge) : null
    ),
    h(
      "p",
      { className: "m-price-amount" },
      h("span", { className: "m-price-num" }, props.price),
      props.period ? h("span", { className: "m-price-period" }, props.period) : null
    ),
    props.note ? h("p", { className: "m-price-note" }, props.note) : null,
    h("ul", { className: "m-price-list" }, (props.features || []).map(function(f, i) {
      return h("li", { key: i }, h(Icon, { name: "check", size: 16 }), h("span", null, f));
    })),
    props.cta || null
  );
}
var navSeq = 0;
function NavBar(props) {
  var navId = React.useState(function() {
    navSeq += 1;
    return "m-nav-" + navSeq;
  })[0];
  var st = React.useState(!!props.defaultOpen);
  var open = st[0];
  return h(
    "header",
    { className: cx("m-nav", props.compact && "m-nav--compact", open && "is-open", props.className) },
    h("div", { className: "m-nav-brand" }, props.brand),
    h("button", {
      type: "button",
      className: "m-nav-toggle",
      "aria-expanded": open ? "true" : "false",
      "aria-controls": navId,
      "aria-label": open ? "Закрыть меню" : "Открыть меню",
      onClick: function() {
        st[1](!open);
      }
    }, h(Icon, { name: open ? "x" : "menu", size: 20 })),
    h(
      "nav",
      { id: navId, className: "m-nav-links", "aria-label": props.label || "Основная навигация" },
      (props.links || []).map(function(l, i) {
        return h("a", {
          key: i,
          href: l.href || "#",
          className: cx("m-nav-link", l.current && "is-current"),
          "aria-current": l.current ? "page" : void 0
        }, l.label);
      })
    ),
    props.actions ? h("div", { className: "m-nav-actions" }, props.actions) : null
  );
}
function Slide(props) {
  var layout = props.layout || "content";
  var big = layout === "title" || layout === "statement";
  var num = props.number != null ? pad2(props.number) + (props.total != null ? " / " + pad2(props.total) : "") : null;
  return h(
    "section",
    {
      className: cx("m-slide", "m-slide--" + layout, props.className),
      "aria-label": typeof props.title === "string" ? props.title : void 0
    },
    h(
      "div",
      { className: "m-slide-inner" },
      h(
        "div",
        { className: "m-slide-top" },
        props.eyebrow ? h("p", { className: "m-eyebrow" }, props.eyebrow) : h("span"),
        num ? h("p", { className: "m-slide-num" }, num) : null
      ),
      h(
        "div",
        { className: "m-slide-main" },
        props.title ? h("h2", { className: cx(big ? "m-display" : "m-h1", "m-slide-title") }, props.title) : null,
        props.children ? h("div", { className: "m-slide-body" }, props.children) : null
      ),
      props.footer ? h("div", { className: "m-slide-foot" }, props.footer) : null
    )
  );
}
var uid = 0;
function useId(prefix) {
  return React.useState(function() {
    uid += 1;
    return prefix + "-" + uid;
  })[0];
}
var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
function Accordion(props) {
  var items = props.items || [];
  var base = useId("m-acc");
  var st = React.useState(props.defaultOpen || []);
  var open = st[0];
  function toggle(id) {
    var was = open.indexOf(id) !== -1;
    st[1](was ? open.filter(function(x) {
      return x !== id;
    }) : props.multiple ? open.concat([id]) : [id]);
  }
  return h("div", { className: cx("m-acc", props.className) }, items.map(function(it, i) {
    var id = it.id != null ? String(it.id) : String(i);
    var on = open.indexOf(id) !== -1;
    var hid = base + "-h" + i, pid = base + "-p" + i;
    return h(
      "div",
      { key: id, className: cx("m-acc-item", on && "is-open") },
      h(
        props.headingLevel || "h3",
        { className: "m-acc-heading" },
        h(
          "button",
          { type: "button", id: hid, className: "m-acc-trigger", "aria-expanded": on ? "true" : "false", "aria-controls": pid, onClick: function() {
            toggle(id);
          } },
          h("span", { className: "m-acc-title" }, it.title),
          h(Icon, { name: "chevron-down", size: 18, className: "m-acc-chevron" })
        )
      ),
      h(
        "div",
        { id: pid, role: "region", "aria-labelledby": hid, className: "m-acc-panel", hidden: !on },
        h("div", { className: "m-acc-content" }, it.content)
      )
    );
  }));
}
function Checkbox(props) {
  var auto = useId("m-chk");
  var id = props.id || auto;
  var ref = React.useRef(null);
  React.useEffect(function() {
    if (ref.current) ref.current.indeterminate = !!props.indeterminate;
  }, [props.indeterminate]);
  var rest = omit(props, ["label", "description", "indeterminate", "className", "error", "id"]);
  return h(
    "div",
    { className: cx("m-check", props.error && "is-invalid", props.disabled && "is-disabled", props.className) },
    h("input", Object.assign({ ref, id, type: "checkbox", className: "m-check-input", "aria-invalid": props.error ? "true" : void 0, "aria-describedby": props.description ? id + "-d" : void 0 }, rest)),
    h("span", { className: "m-check-box", "aria-hidden": "true" }, h(Icon, { name: "check", size: 14, className: "m-check-tick" }), h(Icon, { name: "minus", size: 14, className: "m-check-dash" })),
    h(
      "span",
      { className: "m-check-text" },
      h("label", { htmlFor: id, className: "m-check-label" }, props.label),
      props.description ? h("span", { id: id + "-d", className: "m-check-desc" }, props.description) : null
    )
  );
}
function RadioGroup(props) {
  var base = useId("m-radio");
  var opts = props.options || [];
  var st = React.useState(props.defaultValue !== void 0 ? props.defaultValue : null);
  var value = props.value !== void 0 ? props.value : st[0];
  return h(
    "fieldset",
    { className: cx("m-radios", props.orientation === "horizontal" && "m-radios--row", props.className) },
    props.label ? h("legend", { className: "m-radios-legend" }, props.label) : null,
    h("div", { className: "m-radios-list" }, opts.map(function(o, i) {
      var id = base + "-" + i;
      return h(
        "div",
        { key: o.value, className: cx("m-check", "m-radio", o.disabled && "is-disabled") },
        h("input", {
          id,
          type: "radio",
          name: props.name || base,
          value: o.value,
          className: "m-check-input",
          checked: value === o.value,
          disabled: o.disabled,
          "aria-describedby": o.description ? id + "-d" : void 0,
          onChange: function() {
            if (props.value === void 0) st[1](o.value);
            if (props.onChange) props.onChange(o.value);
          }
        }),
        h("span", { className: "m-check-box", "aria-hidden": "true" }),
        h(
          "span",
          { className: "m-check-text" },
          h("label", { htmlFor: id, className: "m-check-label" }, o.label),
          o.description ? h("span", { id: id + "-d", className: "m-check-desc" }, o.description) : null
        )
      );
    }))
  );
}
function Switch(props) {
  var auto = useId("m-sw");
  var id = props.id || auto;
  var st = React.useState(!!props.defaultChecked);
  var on = props.checked !== void 0 ? props.checked : st[0];
  function flip() {
    if (props.disabled) return;
    if (props.checked === void 0) st[1](!on);
    if (props.onChange) props.onChange(!on);
  }
  return h(
    "div",
    { className: cx("m-switch", props.disabled && "is-disabled", props.className) },
    h("button", {
      type: "button",
      role: "switch",
      id,
      className: "m-switch-track",
      disabled: props.disabled,
      "aria-checked": on ? "true" : "false",
      "aria-labelledby": id + "-l",
      "aria-describedby": props.description ? id + "-d" : void 0,
      onClick: flip
    }, h("span", { className: "m-switch-thumb" })),
    h(
      "span",
      { className: "m-check-text" },
      h("span", { id: id + "-l", className: "m-check-label", onClick: flip }, props.label),
      props.description ? h("span", { id: id + "-d", className: "m-check-desc" }, props.description) : null
    )
  );
}
function Select(props) {
  var auto = useId("m-sel");
  var id = props.id || auto;
  var msg = props.error || props.hint;
  var msgId = msg ? id + "-msg" : void 0;
  var rest = omit(props, ["label", "hint", "error", "options", "placeholder", "className", "id"]);
  var usePlaceholder = props.placeholder && props.value === void 0 && props.defaultValue === void 0;
  return h(
    "div",
    { className: cx("m-field", "m-select", props.error && "m-field--error", props.className) },
    props.label ? h("label", { className: "m-field-label", htmlFor: id }, props.label) : null,
    h(
      "div",
      { className: "m-field-box" },
      h(
        "select",
        Object.assign({
          id,
          className: "m-field-control m-select-control",
          "aria-invalid": props.error ? "true" : void 0,
          "aria-describedby": msgId
        }, usePlaceholder ? { defaultValue: "" } : {}, rest),
        props.placeholder ? h("option", { value: "", disabled: true }, props.placeholder) : null,
        (props.options || []).map(function(o) {
          return h("option", { key: o.value, value: o.value, disabled: o.disabled }, o.label);
        })
      ),
      h(Icon, { name: "chevron-down", size: 16, className: "m-select-chevron" })
    ),
    msg ? h(
      "p",
      { id: msgId, className: "m-field-msg" },
      props.error ? h(Icon, { name: "alert-circle", size: 14 }) : null,
      h("span", null, msg)
    ) : null
  );
}
function Tabs(props) {
  var tabs = props.tabs || [];
  var base = useId("m-tabs");
  var st = React.useState(props.defaultValue !== void 0 ? props.defaultValue : tabs[0] && tabs[0].id);
  var value = props.value !== void 0 ? props.value : st[0];
  var refs = React.useRef({});
  function select(id, focus) {
    if (props.value === void 0) st[1](id);
    if (props.onChange) props.onChange(id);
    if (focus && refs.current[id]) refs.current[id].focus();
  }
  function onKey(e, i) {
    var n = tabs.length, j = null;
    if (e.key === "ArrowRight") j = (i + 1) % n;
    else if (e.key === "ArrowLeft") j = (i - 1 + n) % n;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = n - 1;
    if (j !== null) {
      e.preventDefault();
      select(tabs[j].id, true);
    }
  }
  return h(
    "div",
    { className: cx("m-tabs", props.className) },
    h("div", { role: "tablist", "aria-label": props.label, className: "m-tabs-list" }, tabs.map(function(t, i) {
      var on = t.id === value;
      return h("button", {
        key: t.id,
        ref: function(el) {
          refs.current[t.id] = el;
        },
        type: "button",
        role: "tab",
        id: base + "-t-" + t.id,
        "aria-selected": on ? "true" : "false",
        "aria-controls": base + "-p-" + t.id,
        tabIndex: on ? 0 : -1,
        className: cx("m-tab", on && "is-on"),
        onClick: function() {
          select(t.id);
        },
        onKeyDown: function(e) {
          onKey(e, i);
        }
      }, t.label, t.count != null ? h("span", { className: "m-tab-count" }, t.count) : null);
    })),
    tabs.map(function(t) {
      var on = t.id === value;
      return h("div", { key: t.id, role: "tabpanel", id: base + "-p-" + t.id, "aria-labelledby": base + "-t-" + t.id, hidden: !on, tabIndex: 0, className: "m-tabs-panel" }, on ? t.content : null);
    })
  );
}
function Tooltip(props) {
  var id = useId("m-tip");
  var st = React.useState(false);
  var timer = React.useRef(null);
  React.useEffect(function() {
    return function() {
      clearTimeout(timer.current);
    };
  }, []);
  function show(now) {
    clearTimeout(timer.current);
    if (now) st[1](true);
    else timer.current = setTimeout(function() {
      st[1](true);
    }, props.delay != null ? props.delay : 400);
  }
  function hide() {
    clearTimeout(timer.current);
    st[1](false);
  }
  var child = React.Children.only(props.children);
  return h(
    "span",
    {
      className: cx("m-tip-wrap", props.className),
      onMouseEnter: function() {
        show(false);
      },
      onMouseLeave: hide,
      onFocus: function() {
        show(true);
      },
      onBlur: hide,
      onKeyDown: function(e) {
        if (e.key === "Escape") hide();
      }
    },
    React.cloneElement(child, { "aria-describedby": id }),
    h("span", { role: "tooltip", id, className: cx("m-tip", "m-tip--" + (props.side || "top"), (st[0] || props.open) && "is-open") }, props.content)
  );
}
function Dialog(props) {
  var id = useId("m-dlg");
  var ref = React.useRef(null);
  var onClose = React.useRef(props.onClose);
  onClose.current = props.onClose;
  React.useEffect(function() {
    if (!props.open) return void 0;
    var prev = document.activeElement;
    var node = ref.current;
    if (props.autoFocus !== false && node) (node.querySelector(FOCUSABLE) || node).focus();
    function onKey(e) {
      if (e.key === "Escape" && onClose.current) {
        e.stopPropagation();
        onClose.current();
      }
      if (e.key === "Tab" && node) {
        var f = node.querySelectorAll(FOCUSABLE);
        if (!f.length) return;
        var a = f[0], z = f[f.length - 1];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          z.focus();
        } else if (!e.shiftKey && document.activeElement === z) {
          e.preventDefault();
          a.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    var overflow = document.body.style.overflow;
    if (!props.inline) document.body.style.overflow = "hidden";
    return function() {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (props.autoFocus !== false && prev && prev.focus) prev.focus();
    };
  }, [props.open]);
  if (!props.open) return null;
  return h(
    "div",
    { className: cx("m-dialog-layer", props.inline && "is-inline") },
    h("div", { className: "m-dialog-scrim", "aria-hidden": "true", onClick: props.dismissible === false ? void 0 : props.onClose }),
    h(
      "div",
      {
        ref,
        role: props.alert ? "alertdialog" : "dialog",
        "aria-modal": "true",
        tabIndex: -1,
        "aria-labelledby": id + "-t",
        "aria-describedby": props.description ? id + "-d" : void 0,
        className: cx("m-dialog", "m-dialog--" + (props.size || "md"), props.className)
      },
      h(
        "div",
        { className: "m-dialog-head" },
        h("h2", { id: id + "-t", className: "m-dialog-title" }, props.title),
        props.onClose ? h("button", { type: "button", className: "m-dialog-close", "aria-label": "Закрыть", onClick: props.onClose }, h(Icon, { name: "x", size: 18 })) : null
      ),
      props.description ? h("p", { id: id + "-d", className: "m-dialog-desc" }, props.description) : null,
      props.children ? h("div", { className: "m-dialog-body" }, props.children) : null,
      props.actions ? h("div", { className: "m-dialog-actions" }, props.actions) : null
    )
  );
}
function Menu(props) {
  var id = useId("m-menu");
  var st = React.useState(false);
  var open = st[0] || !!props.open;
  var wrap = React.useRef(null), list = React.useRef(null), btn = React.useRef(null);
  var items = props.items || [];
  function close(focusBtn) {
    st[1](false);
    if (focusBtn && btn.current) btn.current.focus();
  }
  React.useEffect(function() {
    if (!st[0]) return void 0;
    var first = list.current && list.current.querySelector('[role="menuitem"]:not([aria-disabled="true"])');
    if (first) first.focus();
    function onDoc(e) {
      if (wrap.current && !wrap.current.contains(e.target)) close(false);
    }
    document.addEventListener("mousedown", onDoc);
    return function() {
      document.removeEventListener("mousedown", onDoc);
    };
  }, [st[0]]);
  function onKey(e) {
    var els = Array.prototype.slice.call(list.current.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])'));
    if (!els.length) return;
    var i = els.indexOf(document.activeElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      els[(i + 1) % els.length].focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      els[(i - 1 + els.length) % els.length].focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      els[0].focus();
    } else if (e.key === "End") {
      e.preventDefault();
      els[els.length - 1].focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Tab") {
      close(false);
    }
  }
  var label = props.label || "Действия";
  return h(
    "div",
    { ref: wrap, className: cx("m-menu", props.className) },
    h("button", {
      ref: btn,
      type: "button",
      id: id + "-b",
      className: cx("m-btn", "m-btn--" + (props.variant || "secondary"), "m-btn--" + (props.size || "md"), props.iconOnly && "m-btn--icon"),
      "aria-haspopup": "menu",
      "aria-expanded": open ? "true" : "false",
      "aria-controls": id,
      "aria-label": props.iconOnly ? label : void 0,
      onClick: function() {
        st[1](!st[0]);
      },
      onKeyDown: function(e) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          st[1](true);
        }
      }
    }, props.iconOnly ? h(Icon, { name: props.icon || "more-horizontal", size: 16 }) : [h("span", { key: "l", className: "m-btn-label" }, label), h(Icon, { key: "c", name: "chevron-down", size: 16 })]),
    h(
      "div",
      { ref: list, id, role: "menu", "aria-labelledby": id + "-b", hidden: !open, onKeyDown: onKey, className: cx("m-menu-list", "m-menu-list--" + (props.align || "start")) },
      items.map(function(it, i) {
        if (it.separator) return h("div", { key: "s" + i, role: "separator", className: "m-menu-sep" });
        return h(
          "button",
          {
            key: i,
            type: "button",
            role: "menuitem",
            tabIndex: -1,
            "aria-disabled": it.disabled ? "true" : void 0,
            className: cx("m-menu-item", it.danger && "is-danger"),
            onClick: function() {
              if (it.disabled) return;
              if (it.onSelect) it.onSelect();
              close(true);
            }
          },
          it.icon ? h(Icon, { name: it.icon, size: 16 }) : null,
          h("span", { className: "m-menu-label" }, it.label),
          it.shortcut ? h("kbd", { className: "m-menu-kbd" }, it.shortcut) : null
        );
      })
    )
  );
}
function Toast(props) {
  var tone = props.tone || "info";
  return h(
    "div",
    { className: cx("m-toast", "m-toast--" + tone, props.className), role: tone === "critical" ? "alert" : void 0 },
    h(Icon, { name: NOTICE_ICON[tone] || "info", size: 18, className: "m-toast-icon" }),
    h(
      "div",
      { className: "m-toast-body" },
      props.title ? h("p", { className: "m-toast-title" }, props.title) : null,
      props.children ? h("p", { className: "m-toast-text" }, props.children) : null
    ),
    props.action ? h("div", { className: "m-toast-action" }, props.action) : null,
    props.onClose ? h("button", { type: "button", className: "m-toast-close", "aria-label": "Закрыть уведомление", onClick: props.onClose }, h(Icon, { name: "x", size: 16 })) : null
  );
}
function ToastRegion(props) {
  return h("section", {
    className: cx("m-toasts", "m-toasts--" + (props.position || "bottom-end"), props.inline && "is-inline", props.className),
    "aria-label": props.label || "Уведомления",
    "aria-live": "polite"
  }, props.children);
}
function pageList(page, total, sib) {
  var out = [1];
  var s = Math.max(2, page - sib), e = Math.min(total - 1, page + sib);
  if (s > 2) out.push("gap-l");
  for (var i = s; i <= e; i++) out.push(i);
  if (e < total - 1) out.push("gap-r");
  if (total > 1) out.push(total);
  return out;
}
function Pagination(props) {
  var total = Math.max(1, props.total || 1);
  var st = React.useState(props.defaultPage || 1);
  var page = props.page !== void 0 ? props.page : st[0];
  function go(p) {
    if (p < 1 || p > total || p === page) return;
    if (props.page === void 0) st[1](p);
    if (props.onChange) props.onChange(p);
  }
  return h(
    "nav",
    { className: cx("m-pages", props.className), "aria-label": props.label || "Страницы" },
    h("button", { type: "button", className: "m-page m-page--edge", disabled: page <= 1, "aria-label": "Предыдущая страница", onClick: function() {
      go(page - 1);
    } }, h(Icon, { name: "chevron-left", size: 16 })),
    h("ol", { className: "m-pages-list" }, pageList(page, total, props.siblings != null ? props.siblings : 1).map(function(p) {
      if (typeof p === "string") return h("li", { key: p, className: "m-page-gap", "aria-hidden": "true" }, "…");
      return h("li", { key: p }, h("button", {
        type: "button",
        className: cx("m-page", p === page && "is-current"),
        "aria-current": p === page ? "page" : void 0,
        "aria-label": "Страница " + p,
        onClick: function() {
          go(p);
        }
      }, p));
    })),
    h("button", { type: "button", className: "m-page m-page--edge", disabled: page >= total, "aria-label": "Следующая страница", onClick: function() {
      go(page + 1);
    } }, h(Icon, { name: "chevron-right", size: 16 }))
  );
}
function Breadcrumbs(props) {
  var items = props.items || [];
  return h(
    "nav",
    { className: cx("m-crumbs", props.className), "aria-label": props.label || "Навигационная цепочка" },
    h("ol", { className: "m-crumbs-list" }, items.map(function(it, i) {
      var last = i === items.length - 1;
      return h(
        "li",
        { key: i, className: "m-crumb" },
        last ? h("span", { "aria-current": "page", className: "m-crumb-current" }, it.label) : h("a", { href: it.href || "#", className: "m-crumb-link" }, it.label),
        last ? null : h(Icon, { name: "chevron-right", size: 14, className: "m-crumb-sep" })
      );
    }))
  );
}
function initials(name) {
  return String(name || "").trim().split(/\s+/).slice(0, 2).map(function(w) {
    return w.charAt(0).toUpperCase();
  }).join("");
}
function Avatar(props) {
  var size = props.size || "md";
  return h(
    "span",
    { className: cx("m-avatar", "m-avatar--" + size, props.className) },
    props.src ? h("img", { src: props.src, alt: props.name || "", className: "m-avatar-img" }) : h("span", { role: props.name ? "img" : void 0, "aria-label": props.name, "aria-hidden": props.name ? void 0 : "true", className: "m-avatar-initials" }, initials(props.name))
  );
}
function AvatarGroup(props) {
  var people = props.people || [];
  var max = props.max || 4;
  var shown = people.slice(0, max);
  var rest = people.length - shown.length;
  return h(
    "span",
    { className: cx("m-avatars", props.className), role: "group", "aria-label": props.label || "Участники: " + people.length },
    shown.map(function(p, i) {
      return h(Avatar, { key: i, name: p.name, src: p.src, size: props.size });
    }),
    rest > 0 ? h("span", { className: cx("m-avatar", "m-avatar--" + (props.size || "md"), "m-avatar--more") }, "+" + rest) : null
  );
}
function Skeleton(props) {
  var lines = props.lines || 1;
  if (lines > 1) {
    return h(
      "span",
      { className: cx("m-skel-stack", props.className), "aria-hidden": "true" },
      Array.apply(null, Array(lines)).map(function(_, i) {
        return h("span", { key: i, className: "m-skel", style: { width: i === lines - 1 ? "62%" : "100%" } });
      })
    );
  }
  return h("span", { className: cx("m-skel", props.circle && "m-skel--circle", props.className), "aria-hidden": "true", style: { width: props.width, height: props.height } });
}
function Progress(props) {
  var id = useId("m-prog");
  var max = props.max || 100;
  var ind = props.value == null;
  var pct = ind ? 0 : Math.max(0, Math.min(100, props.value / max * 100));
  var shown = props.valueText || Math.round(pct) + " %";
  return h(
    "div",
    { className: cx("m-progress", ind && "is-indeterminate", props.tone && "m-progress--" + props.tone, props.className) },
    props.label || props.showValue ? h(
      "div",
      { className: "m-progress-head" },
      props.label ? h("span", { id: id + "-l", className: "m-progress-label" }, props.label) : h("span"),
      props.showValue && !ind ? h("span", { className: "m-progress-value" }, shown) : null
    ) : null,
    h("div", {
      className: "m-progress-track",
      role: "progressbar",
      "aria-labelledby": props.label ? id + "-l" : void 0,
      "aria-label": props.label ? void 0 : "Прогресс",
      "aria-valuemin": 0,
      "aria-valuemax": max,
      "aria-valuenow": ind ? void 0 : props.value,
      "aria-valuetext": ind ? void 0 : shown
    }, h("span", { className: "m-progress-bar", style: ind ? void 0 : { width: pct + "%" } }))
  );
}
function Spinner(props) {
  var size = props.size || 20;
  return h(
    "span",
    { className: cx("m-spinner", props.className), role: "status", "aria-label": props.label || "Загрузка" },
    h(
      "svg",
      { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true", focusable: "false" },
      h("circle", { cx: 12, cy: 12, r: 9, stroke: "currentColor", strokeOpacity: 0.2, strokeWidth: 2.5 }),
      h("path", { d: "M21 12a9 9 0 0 0-9-9", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round" })
    )
  );
}
var EMPTY_ICON = { zero: "inbox", "no-results": "search-x", error: "alert-triangle" };
function EmptyState(props) {
  var kind = props.kind || "zero";
  return h(
    "div",
    { className: cx("m-empty", "m-empty--" + kind, props.className), role: kind === "error" ? "alert" : void 0 },
    h("span", { className: "m-empty-icon" }, h(Icon, { name: props.icon || EMPTY_ICON[kind] || "inbox", size: 24 })),
    h("h3", { className: "m-h3 m-empty-title" }, props.title),
    props.text ? h("p", { className: "m-empty-text" }, props.text) : null,
    props.action || props.secondaryAction ? h("div", { className: "m-empty-actions" }, props.action || null, props.secondaryAction || null) : null
  );
}
function Announcement(props) {
  return h(
    "div",
    { className: cx("m-announce", props.className), role: "region", "aria-label": props.label || "Объявление" },
    h(
      "p",
      { className: "m-announce-text" },
      h("span", null, props.children),
      props.href ? h("a", { href: props.href, className: "m-announce-link" }, props.linkLabel || "Подробнее", h(Icon, { name: "arrow-right", size: 14 })) : null
    ),
    props.onClose ? h("button", { type: "button", className: "m-announce-close", "aria-label": "Скрыть объявление", onClick: props.onClose }, h(Icon, { name: "x", size: 16 })) : null
  );
}
function LogoStrip(props) {
  var logos = props.logos || [];
  function row(hidden) {
    return h("ul", { className: "m-logos-row", "aria-hidden": hidden ? "true" : void 0 }, logos.map(function(l, i) {
      return h("li", { key: i, className: "m-logo" }, l.src ? h("img", { src: l.src, alt: hidden ? "" : l.name, className: "m-logo-img" }) : h("span", { className: "m-logo-word" }, l.name));
    }));
  }
  return h(
    "section",
    { className: cx("m-logos", props.marquee && "is-marquee", props.className), "aria-label": props.label || "Клиенты" },
    props.title ? h("p", { className: "m-eyebrow m-logos-title" }, props.title) : null,
    h("div", { className: "m-logos-viewport" }, h("div", { className: "m-logos-track" }, row(false), props.marquee ? row(true) : null))
  );
}
function Marquee(props) {
  var items = props.items || [];
  function seqRow(hidden) {
    return h("div", { className: "m-marquee-seq", "aria-hidden": hidden ? "true" : void 0 }, items.map(function(t, i) {
      return h("span", { key: i, className: "m-marquee-item" }, t, h("span", { className: "m-marquee-sep", "aria-hidden": "true" }, props.separator || "•"));
    }));
  }
  return h(
    "div",
    { className: cx("m-marquee", props.size && "m-marquee--" + props.size, props.className), role: "marquee", "aria-label": props.label || items.join(" · ") },
    h("div", { className: "m-marquee-track" }, seqRow(false), seqRow(true))
  );
}
function TrustBar(props) {
  return h("ul", { className: cx("m-trust", props.className) }, (props.items || []).map(function(it, i) {
    return h(
      "li",
      { key: i, className: "m-trust-item" },
      it.icon ? h(Icon, { name: it.icon, size: 20, className: "m-trust-icon" }) : null,
      h(
        "span",
        { className: "m-trust-copy" },
        h("span", { className: "m-trust-title" }, it.title),
        it.text ? h("span", { className: "m-trust-text" }, it.text) : null
      )
    );
  }));
}
function StatGroup(props) {
  return h(
    "section",
    { className: cx("m-statgroup", props.className) },
    props.eyebrow || props.title || props.lede ? h(
      "div",
      { className: "m-statgroup-head" },
      props.eyebrow ? h("p", { className: "m-eyebrow" }, props.eyebrow) : null,
      props.title ? h("h2", { className: "m-h2" }, props.title) : null,
      props.lede ? h("p", { className: "m-lede" }, props.lede) : null
    ) : null,
    h("div", { className: "m-statgroup-grid" }, (props.stats || []).map(function(s, i) {
      return h(Stat, Object.assign({ key: i }, s));
    }))
  );
}
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function Subscribe(props) {
  var done = React.useState(false);
  var err = React.useState(null);
  function submit(e) {
    e.preventDefault();
    var v = String(e.target.elements.email.value || "").trim();
    if (!EMAIL_RE.test(v)) {
      err[1]("В адресе не хватает «@» или доменной зоны — например, name@company.ru");
      return;
    }
    err[1](null);
    done[1](true);
    if (props.onSubmit) props.onSubmit(v);
  }
  return h(
    "section",
    { className: cx("m-subscribe", props.className) },
    h(
      "div",
      { className: "m-subscribe-copy" },
      props.title ? h("h2", { className: "m-h2" }, props.title) : null,
      props.text ? h("p", { className: "m-lede" }, props.text) : null
    ),
    done[0] ? h("p", { className: "m-subscribe-done", role: "status" }, h(Icon, { name: "check-circle", size: 18 }), h("span", null, props.doneText || "Готово. Письмо с подтверждением уже в почте.")) : h(
      "form",
      { className: "m-subscribe-form", onSubmit: submit, noValidate: true },
      h(Field, { name: "email", type: "email", label: props.label || "Почта", placeholder: props.placeholder || "name@company.ru", error: err[0], autoComplete: "email" }),
      h(Button, { type: "submit", variant: "primary" }, props.button || "Подписаться"),
      props.legal ? h("p", { className: "m-subscribe-legal" }, props.legal) : null
    )
  );
}
function Footer(props) {
  var v = props.variant || "full";
  return h(
    "footer",
    { className: cx("m-footer", "m-footer--" + v, props.className) },
    v === "full" ? h(
      "div",
      { className: "m-footer-top" },
      h(
        "div",
        { className: "m-footer-brand" },
        h("p", { className: "m-footer-name" }, props.brand),
        props.tagline ? h("p", { className: "m-footer-tag" }, props.tagline) : null,
        props.extra || null
      ),
      (props.columns || []).map(function(c, i) {
        return h(
          "nav",
          { key: i, className: "m-footer-col", "aria-label": typeof c.title === "string" ? c.title : void 0 },
          h("p", { className: "m-footer-head" }, c.title),
          h("ul", { className: "m-footer-links" }, (c.links || []).map(function(l, j) {
            return h("li", { key: j }, l.href ? h("a", { href: l.href, className: "m-footer-link" }, l.label) : h("span", { className: "m-footer-text" }, l.label));
          }))
        );
      })
    ) : null,
    h(
      "div",
      { className: "m-footer-bottom" },
      v === "minimal" ? h("p", { className: "m-footer-name" }, props.brand) : null,
      props.legal ? h("p", { className: "m-footer-legal" }, props.legal) : null,
      props.bottom ? h("div", { className: "m-footer-meta" }, props.bottom) : null
    )
  );
}
function BarList(props) {
  var items = props.items || [];
  var max = props.max || Math.max.apply(null, items.map(function(it) {
    return it.value;
  }).concat([0]));
  return h(
    "figure",
    { className: cx("m-barlist", props.className) },
    props.title ? h("figcaption", { className: "m-barlist-title" }, props.title) : null,
    h("ul", { className: "m-barlist-list" }, items.map(function(it, i) {
      var pct = max ? Math.max(0, it.value / max * 100) : 0;
      var shown = it.display != null ? it.display : it.value;
      return h(
        "li",
        { key: i, className: "m-barlist-row", title: it.label + ": " + shown },
        h("span", { className: "m-barlist-label" }, it.label),
        h("span", { className: "m-barlist-track", "aria-hidden": "true" }, h("span", { className: "m-barlist-bar", style: { width: pct + "%" } })),
        h("span", { className: "m-barlist-value" }, shown)
      );
    }))
  );
}
export {
  Accordion,
  Announcement,
  Avatar,
  AvatarGroup,
  Badge,
  BarList,
  Breadcrumbs,
  Button,
  Card,
  Checkbox,
  DataTable,
  Dialog,
  EmptyState,
  FeatureList,
  Field,
  Footer,
  Hero,
  Icon,
  LogoStrip,
  Marquee,
  Menu,
  NavBar,
  Notice,
  Pagination,
  PriceCard,
  Progress,
  Quote,
  RadioGroup,
  Segmented,
  Select,
  Skeleton,
  Slide,
  Spinner,
  Stat,
  StatGroup,
  Subscribe,
  Switch,
  Tabs,
  Toast,
  ToastRegion,
  Tooltip,
  TrustBar
};

// scan.js
// アイコンを押した時だけ、今開いているページに 1 回だけ注入される。
// このファイルは「出品情報を1つ取り出して返す」だけ。保存や判定は popup.js 側で行う。
// 最後の式（即時関数の戻り値）がそのまま popup.js に渡るので、JSONにできる値だけ返すこと。
(() => {
  const text = (el) => (el && el.textContent ? el.textContent.trim() : "");

  // 1) いちばん信頼できる: 構造化データ JSON-LD (schema.org Product/Offer)
  //    まともなEC/フリマは大抵これを埋め込んでいる。CSSクラス名の当てずっぽうより堅い。
  function fromJsonLd() {
    const blocks = [...document.querySelectorAll('script[type="application/ld+json"]')];
    for (const b of blocks) {
      let data;
      try { data = JSON.parse(b.textContent); } catch (e) { continue; }
      const items = Array.isArray(data) ? data : (data["@graph"] || [data]);
      for (const it of items) {
        if (!it) continue;
        const t = it["@type"];
        const isProduct = t === "Product" || (Array.isArray(t) && t.includes("Product"));
        if (!isProduct) continue;
        const offer = Array.isArray(it.offers) ? it.offers[0] : it.offers;
        const priceRaw = offer ? (offer.price ?? offer.lowPrice) : NaN;
        const price = Number(priceRaw);
        return {
          title: it.name || "",
          price: isFinite(price) && price > 0 ? price : NaN,
          category: it.category ? String(it.category) : ""
        };
      }
    }
    return null;
  }

  // 2) 次点: meta タグ (OpenGraph / product price)
  function fromMeta() {
    const m = (sel) => { const e = document.querySelector(sel); return e ? e.getAttribute("content") : ""; };
    const priceRaw =
      m('meta[property="product:price:amount"]') ||
      m('meta[property="og:price:amount"]') ||
      m('meta[itemprop="price"]');
    const price = Number((String(priceRaw).match(/[\d.]+/) || ["0"])[0]);
    const title = m('meta[property="og:title"]') || document.title;
    return { title, price: isFinite(price) && price > 0 ? price : NaN, category: "" };
  }

  // 3) 最後の手段: DOM から推測（サイトによって外す。ノイズ多め）
  function fromDom() {
    const priceEl = document.querySelector('[itemprop="price"], [class*="price" i], [data-price]');
    const priceText =
      text(priceEl) ||
      (priceEl && priceEl.getAttribute ? (priceEl.getAttribute("data-price") || priceEl.getAttribute("content") || "") : "");
    const digits = (priceText.replace(/[^\d,]/g, "").match(/[\d,]+/) || ["0"])[0].replace(/,/g, "");
    const price = Number(digits);
    const title = text(document.querySelector("h1")) || document.title;
    return { title, price: isFinite(price) && price > 0 ? price : NaN, category: "" };
  }

  // 出品者アカウントの登録日数（はっきり日付が見つかった時だけ。無ければ「不明」）
  function sellerAgeDays() {
    const cand = [...document.querySelectorAll('[class*="member-since" i], [class*="joined" i], [data-joined], time')];
    for (const el of cand) {
      const s = (el.getAttribute && el.getAttribute("datetime")) || text(el);
      const hit = s && s.match(/\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}/);
      if (hit) {
        const days = Math.round((Date.now() - new Date(hit[0].replace(/\./g, "/")).getTime()) / 86400000);
        if (isFinite(days) && days >= 0 && days < 36500) return days;
      }
    }
    return NaN;
  }

  function category() {
    const bc = [...document.querySelectorAll('nav a, [class*="breadcrumb" i] a, [itemtype*="BreadcrumbList"] a')]
      .map((a) => text(a)).filter(Boolean).slice(0, 4).join(">");
    return bc || location.hostname;
  }

  const base =
    fromJsonLd() ||
    (() => {
      const meta = fromMeta();
      return isFinite(meta.price) ? meta : fromDom();
    })();

  const images = [...document.images]
    .map((i) => i.src)
    .filter((s) => /^https?:/.test(s))
    .slice(0, 6);

  return {
    listing_id: location.origin + location.pathname,
    host: location.hostname,
    url: location.href,
    title: (base.title || document.title || "").slice(0, 200),
    price: base.price,
    category: base.category || category(),
    seller_age_days: sellerAgeDays(),
    images
  };
})();

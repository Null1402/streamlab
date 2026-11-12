/* common.js — funciones globales compartidas (sin módulos) */

/* ── api ─────────────────────────────────────────────────────────────────────── */
async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    credentials: 'same-origin',
    ...opts,
    body: opts.body != null && typeof opts.body === 'object'
      ? JSON.stringify(opts.body)
      : opts.body
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Error desconocido'), { status: res.status, data });
  return data;
}

/* ── esc — anti-XSS ─────────────────────────────────────────────────────────── */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── colorFor — color estable por nombre ─────────────────────────────────────── */
function colorFor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
  return `hsl(${Math.abs(h) % 360},70%,65%)`;
}

/* ── avatar — inicial con color de fondo ─────────────────────────────────────── */
function avatar(name, size = 32) {
  const color = colorFor(name);
  const letter = esc((name || '?')[0].toUpperCase());
  return `<span class="avatar" style="
    display:inline-flex;align-items:center;justify-content:center;
    width:${size}px;height:${size}px;border-radius:50%;
    background:${color};color:#0f1115;font-weight:700;
    font-size:${Math.round(size * 0.45)}px;flex-shrink:0;
    user-select:none;
  ">${letter}</span>`;
}

/* ── toast ───────────────────────────────────────────────────────────────────── */
function toast(msg, type = 'success') {
  let wrap = document.getElementById('toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'toast-wrap';
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

/* ── renderTopbar ────────────────────────────────────────────────────────────── */
async function renderTopbar(active = '') {
  const bar = document.getElementById('topbar');
  if (!bar) return;

  let me = null;
  try { me = await api('/api/me'); } catch (_) {}

  const link = (href, label, key) =>
    `<a href="${href}" class="${active === key ? 'topbar__nav-active' : ''}">${label}</a>`;

  const authHtml = me
    ? `${avatar(me.username, 28)}
       <a href="/dashboard.html">${esc(me.username)}</a>
       <button class="btn btn-ghost btn-sm" id="btn-logout">Cerrar sesión</button>`
    : `<a href="/login.html" class="btn btn-ghost btn-sm">Iniciar sesión</a>
       <a href="/login.html#register" class="btn btn-primary btn-sm">Registrarse</a>`;

  bar.innerHTML = `
    <a href="/index.html" class="topbar__logo">
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 2L2 6v14h5v2h3l2-2h3l4-4V2H4zm15 13l-3 3h-4l-2 2v-2H6V4h13v11zM11 7H9v5h2V7zm4 0h-2v5h2V7z"/>
      </svg>
      <span>StreamLab</span>
    </a>
    <nav class="topbar__nav">
      ${link('/index.html',     'Explorar',   'explore')}
      ${link('/following.html', 'Siguiendo',  'following')}
      ${me ? link('/dashboard.html', 'Mi canal', 'dashboard') : ''}
    </nav>
    <div class="topbar__spacer"></div>
    <div class="topbar__nav">${authHtml}</div>
  `;

  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      try {
        await api('/api/logout', { method: 'POST' });
        window.location.href = '/index.html';
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }

  return me;
}

/* ── renderSidebar ───────────────────────────────────────────────────────────── */
async function renderSidebar(el) {
  if (!el) return;
  try {
    const channels = await api('/api/channels?live=1');
    if (!channels.length) {
      el.innerHTML = `<p class="sidebar__title">Sin canales en vivo</p>`;
      return;
    }
    el.innerHTML = `
      <p class="sidebar__title">En vivo ahora</p>
      <ul class="sidebar__list">
        ${channels.slice(0, 20).map(ch => `
          <li class="sidebar__item">
            <a href="/c/${esc(ch.username)}">
              ${avatar(ch.username, 26)}
              <span>${esc(ch.username)}</span>
              <span class="badge-live">EN VIVO</span>
            </a>
          </li>
        `).join('')}
      </ul>
    `;
  } catch (_) {
    el.innerHTML = `<p class="sidebar__title">Error al cargar</p>`;
  }
}

/* ── cardHTML ────────────────────────────────────────────────────────────────── */
function cardHTML(ch) {
  const thumbSrc   = ch.thumb ? esc(ch.thumb) : '';
  const isLive     = !!ch.is_live;
  const badgeClass = isLive ? 'card__badge--live' : 'card__badge--offline';
  const badgeText  = isLive ? 'EN VIVO' : 'OFFLINE';

  const thumbInner = thumbSrc
    ? `<img src="${thumbSrc}?t=${Date.now()}" alt="Miniatura de ${esc(ch.username)}" loading="lazy">`
    : `<div class="card__thumb--placeholder">📺</div>`;

  const viewersHtml = isLive
    ? `<span class="card__viewers">${esc(String(ch.viewers ?? 0))} espectadores</span>`
    : '';

  return `
    <article class="card" onclick="location.href='/c/${esc(ch.username)}'">
      <div class="card__thumb">
        ${thumbInner}
        <span class="card__badge ${badgeClass}">${badgeText}</span>
        ${viewersHtml}
      </div>
      <div class="card__info">
        <span class="card__user">${esc(ch.username)}</span>
        <span class="card__title">${esc(ch.title || 'Sin título')}</span>
        <span class="card__category">${esc(ch.category || 'Sin categoría')}</span>
      </div>
    </article>
  `;
}
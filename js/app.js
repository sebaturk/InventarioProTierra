// ---------- constants ----------
var AREAS = ['cocina','barra','piso'];
var AREA_LABEL = { cocina: 'Cocina', barra: 'Barra', piso: 'Piso' };
var MONTHS_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

var state = {
  ready: false,
  db: null,
  assets: null,
  user: null,       // logged-in staff record {id, name, role, area}
  pinBuffer: '',
  screen: 'loading', // loading | bootstrap | login | area | admin
  adminTab: 'revisar',
  currentCount: null, // loaded count doc for area screen
  products: [],
  localItems: {},    // productId -> {qty, reason}
  saveTimer: null
};

function el(html) {
  var d = document.createElement('div');
  d.innerHTML = html.trim();
  return d.firstChild;
}
function root() { return document.getElementById('app'); }
function render(html) { root().innerHTML = html; }
function esc(s) { return (s || '').toString().replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function monthLabel(ym) {
  var parts = ym.split('-'); var m = parseInt(parts[1],10)-1;
  return MONTHS_ES[m] + ' ' + parts[0];
}
function currentYm() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
}
function showToast(msg) {
  var t = el('<div class="toast">'+esc(msg)+'</div>');
  document.body.appendChild(t);
  setTimeout(function(){ t.remove(); }, 2600);
}
function photoUrl(photoId) {
  if (!photoId) return '';
  return window.__firebasePhotoUrl(photoId);
}
function withTimeout(promise, ms, label) {
  return new Promise(function (resolve, reject) {
    var t = setTimeout(function () { reject(new Error('tiempo agotado ' + label)); }, ms);
    promise.then(
      function (v) { clearTimeout(t); resolve(v); },
      function (e) { clearTimeout(t); reject(e); }
    );
  });
}

// Red de seguridad: si algo async falla sin un catch propio (bug nuestro, regla de
// Firestore/Storage que lo bloquea, sin conexión, etc.), que se note en pantalla
// en vez de que el botón parezca "no hacer nada".
window.addEventListener('unhandledrejection', function (ev) {
  console.error('Error no controlado:', ev.reason);
  var msg = (ev.reason && (ev.reason.code || ev.reason.message)) || 'error desconocido';
  showToast('Algo falló (' + msg + ')');
});

// ---------- init ----------
async function init() {
  try {
    await window.__firebaseReady;
  } catch (e) {
    render('<div class="center-screen"><p class="sub">No se pudo conectar con Firebase. Revisá la configuración en js/firebase-config.js y la consola del navegador.</p></div>');
    return;
  }
  state.db = window.__firebaseDb;
  state.assets = window.__firebaseAssets;
  if (!state.db) {
    render('<div class="center-screen"><p class="sub">No se pudo conectar con el almacenamiento. Recargá la página.</p></div>');
    return;
  }
  var staffSnap = await state.db.collection('staff').limit(1).get();
  if (staffSnap.empty) {
    state.screen = 'bootstrap';
  } else {
    state.screen = 'login';
  }
  draw();
}

// ---------- PIN login ----------
function drawLogin() {
  var dots = '';
  for (var i=0;i<4;i++) dots += '<div class="dot'+(i<state.pinBuffer.length?' filled':'')+'"></div>';
  var keys = [1,2,3,4,5,6,7,8,9];
  var padBtns = keys.map(function(k){ return '<button onclick="pinPress('+k+')">'+k+'</button>'; }).join('');
  render(
    '<div class="center-screen" style="width:100%">' +
      '<div class="login-brand"><span class="brand">InventarioPro</span></div>' +
      '<p class="sub" style="text-align:center">Ingresá tu PIN</p>' +
      '<div class="pindots">'+dots+'</div>' +
      '<div class="pinpad">' + padBtns +
        '<div></div><button onclick="pinPress(0)">0</button><button onclick="pinBackspace()" style="border:none;background:none;font-size:18px;color:var(--text-secondary)">⌫</button>' +
      '</div>' +
      '<div id="login-error" style="color:var(--danger);font-size:13px;text-align:center;height:18px;margin-top:14px"></div>' +
    '</div>'
  );
}
function pinPress(d) {
  if (state.pinBuffer.length >= 4) return;
  state.pinBuffer += d;
  drawLogin();
  if (state.pinBuffer.length === 4) attemptLogin();
}
function pinBackspace() {
  state.pinBuffer = state.pinBuffer.slice(0,-1);
  drawLogin();
}
async function attemptLogin() {
  var pin = state.pinBuffer;
  var snap;
  try {
    snap = await state.db.collection('staff').where('pin','==',pin).where('active','==',true).limit(1).get();
  } catch (e) {
    console.error('Error verificando PIN:', e);
    showLoginError('Error de conexión (' + (e.code || e.message) + ')');
    return;
  }
  if (snap.empty) {
    document.getElementById('login-error').textContent = 'PIN incorrecto';
    state.pinBuffer = '';
    setTimeout(drawLogin, 400);
    return;
  }
  var doc = snap.docs[0];
  state.user = Object.assign({id: doc.id}, doc.data());
  state.pinBuffer = '';
  state.screen = state.user.role === 'admin' ? 'admin' : 'area';
  try {
    await draw();
  } catch (e) {
    // El PIN era correcto; falló al cargar los datos de la pantalla.
    console.error('Error cargando la pantalla:', e);
    var code = (e.code || e.message || 'desconocido');
    state.user = null;
    state.screen = 'login';
    drawLogin();
    showLoginError('No se pudieron cargar los datos (' + code + ')');
  }
}
function showLoginError(msg) {
  state.pinBuffer = '';
  drawLogin();
  var box = document.getElementById('login-error');
  if (box) { box.textContent = msg; box.style.height = 'auto'; }
}
function logout() {
  state.user = null;
  state.currentCount = null;
  state.localItems = {};
  state.screen = 'login';
  draw();
}

// ---------- bootstrap first admin ----------
function drawBootstrap() {
  render(
    '<div class="center-screen" style="width:100%">' +
    '<div class="card" style="width:100%">' +
      '<h2>Configuración inicial</h2>' +
      '<p class="sub">Todavía no hay usuarios. Creá el primer administrador.</p>' +
      '<label class="field">Tu nombre</label>' +
      '<input type="text" id="bs-name" placeholder="Ej: Martín">' +
      '<label class="field">Elegí un PIN de 4 dígitos</label>' +
      '<input type="tel" id="bs-pin" maxlength="4" placeholder="0000">' +
      '<button class="btn btn-primary" style="margin-top:18px" onclick="createFirstAdmin()">Crear administrador</button>' +
    '</div></div>'
  );
}
async function createFirstAdmin() {
  var name = document.getElementById('bs-name').value.trim();
  var pin = document.getElementById('bs-pin').value.trim();
  if (!name || !/^\d{4}$/.test(pin)) { showToast('Completá el nombre y un PIN de 4 dígitos'); return; }
  try {
    await state.db.collection('staff').add({ name: name, pin: pin, role: 'admin', area: null, active: true, createdAt: new Date().toISOString() });
    showToast('Administrador creado. Iniciá sesión.');
    state.screen = 'login';
    draw();
  } catch (e) {
    console.error('Error creando administrador:', e);
    showToast('No se pudo crear (' + (e.code || e.message) + ')');
  }
}

// ---------- topbar ----------
function topbar() {
  if (!state.user) return '';
  var roleLabel = state.user.role === 'admin' ? 'Administrador' : AREA_LABEL[state.user.area] + ' · Encargado';
  return '<div class="topbar"><span class="brand">InventarioPro</span><div class="topbar-right"><div class="who"><span class="name">'+esc(state.user.name)+'</span><span class="role">'+esc(roleLabel)+'</span></div><button class="logout" onclick="logout()">Salir</button></div></div>';
}

// ---------- AREA SCREEN ----------
async function drawArea() {
  var area = state.user.area;
  var ym = currentYm();
  var countId = area + '_' + ym;
  var countRef = state.db.doc('counts/' + countId);
  var snap = await countRef.get();

  var prodSnap = await state.db.collection('products').where('area','==',area).where('status','==','approved').get();
  var products = prodSnap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
  products.sort(function(a,b){ return a.name.localeCompare(b.name); });
  state.products = products;

  if (!snap.exists) {
    // find last approved count for baseline
    // Sin orderBy en la consulta: Firestore exigiría un índice compuesto.
    // Son pocos documentos por área, así que se ordena acá en el navegador.
    var prevSnap = await state.db.collection('counts').where('area','==',area).where('status','==','approved').get();
    var baseline = {};
    if (!prevSnap.empty) {
      var prevDocs = prevSnap.docs.map(function(d){ return d.data(); })
        .filter(function(d){ return d.month !== ym; })
        .sort(function(a,b){ return a.month < b.month ? 1 : (a.month > b.month ? -1 : 0); });
      if (prevDocs.length) baseline = prevDocs[0].items || {};
    }
    var items = {};
    products.forEach(function(p){
      var prevQty = (baseline[p.id] && typeof baseline[p.id].qty === 'number') ? baseline[p.id].qty : 0;
      items[p.id] = { qty: null, previousQty: prevQty, reason: '' };
    });
    var newDoc = { area: area, month: ym, status: 'draft', items: items, createdAt: new Date().toISOString() };
    await countRef.set(newDoc);
    snap = await countRef.get();
  }

  state.currentCount = Object.assign({id: countId}, snap.data());
  state.localItems = JSON.parse(JSON.stringify(state.currentCount.items || {}));
  renderAreaScreen();
}

function renderAreaScreen() {
  var c = state.currentCount;
  var ym = currentYm();
  var status = c.status;
  var banner = '';
  if (status === 'returned') {
    banner = '<div class="banner">↩︎ El manager devolvió este conteo'+(c.managerNote ? ': "'+esc(c.managerNote)+'"' : '')+'. Revisalo y volvé a enviarlo.</div>';
  } else if (status === 'submitted') {
    banner = '<div class="banner" style="background:var(--success-bg);color:var(--success)">✓ Enviado, esperando revisión del manager.</div>';
  } else if (status === 'approved') {
    banner = '<div class="banner" style="background:var(--success-bg);color:var(--success)">✓ Conteo de '+monthLabel(ym)+' aprobado.</div>';
  } else {
    banner = '<div class="banner">Conteo de '+monthLabel(ym)+' pendiente de completar.</div>';
  }

  var readOnly = status === 'submitted' || status === 'approved';
  function diffBadgeHtml(diff) {
    if (diff === null) return '';
    if (diff === 0) return '<span class="badge badge-ok">Sin cambios</span>';
    if (diff > 0) return '<span class="badge badge-ok">+'+diff+'</span>';
    return '<span class="badge badge-danger">'+diff+'</span>';
  }
  var rows = state.products.map(function(p){
    var it = state.localItems[p.id] || { qty: null, previousQty: 0, reason: '' };
    var qtyVal = it.qty === null || it.qty === undefined ? '' : it.qty;
    var diff = (it.qty === null || it.qty === undefined) ? null : (it.qty - it.previousQty);
    var photo = p.photoId ? '<img src="'+photoUrl(p.photoId)+'">' : '📦';
    var showReason = diff !== null && diff !== 0;
    return (
      '<div class="product-row" style="flex-wrap:wrap">' +
        '<div class="thumb">'+photo+'</div>' +
        '<div class="product-info">' +
          '<div class="pname">'+esc(p.name)+' <button type="button" class="edit-link" onclick="openEditProduct(\''+p.id+'\')" title="Editar nombre, descripción o foto">✏️</button></div>' +
          (p.uso ? '<div class="puso">'+esc(p.uso)+'</div>' : '') +
          '<div class="pmeta">Anterior: '+it.previousQty+' <span id="diff-'+p.id+'">'+diffBadgeHtml(diff)+'</span></div>' +
        '</div>' +
        '<input class="qty-input" id="qty-'+p.id+'" type="number" min="0" inputmode="numeric" placeholder="0" value="'+qtyVal+'" '+(readOnly?'disabled':'')+' oninput="updateQty(\''+p.id+'\', this.value)">' +
        '<div style="flex-basis:100%;display:'+(showReason?'block':'none')+'" id="reasonwrap-'+p.id+'">' +
          '<div class="reason-box"><input type="text" id="reason-'+p.id+'" placeholder="Motivo (rotura, compra, etc.)" value="'+esc(it.reason||'')+'" '+(readOnly?'disabled':'')+' oninput="updateReason(\''+p.id+'\', this.value)"></div>' +
        '</div>' +
      '</div>'
    );
  }).join('');

  if (state.products.length === 0) {
    rows = '<div class="empty"><div class="icon">📋</div><p>Todavía no hay productos cargados en '+AREA_LABEL[state.user.area]+'.</p></div>';
  }

  var allFilled = state.products.every(function(p){ var it = state.localItems[p.id]; return it && it.qty !== null && it.qty !== undefined && it.qty !== ''; });

  render(
    topbar() +
    '<main>' +
      '<h1>'+AREA_LABEL[state.user.area]+'</h1>' +
      '<p class="sub">Conteo de '+monthLabel(ym)+'</p>' +
      banner +
      '<div class="card product-grid">' + rows + '</div>' +
      (readOnly ? '' :
        '<button class="btn btn-primary" id="submit-btn" '+(allFilled?'':'disabled')+' onclick="submitCount()">Enviar conteo</button>'
      ) +
      '<div style="margin-top:14px">' +
        '<button class="btn btn-secondary" onclick="openSuggestProduct()">+ Sugerir nuevo producto</button>' +
      '</div>' +
    '</main>'
  );

  window._diffBadgeHtml = diffBadgeHtml;
}

function updateQty(pid, val) {
  var n = val === '' ? null : parseInt(val, 10);
  if (!state.localItems[pid]) state.localItems[pid] = { qty: null, previousQty: 0, reason: '' };
  var it = state.localItems[pid];
  it.qty = isNaN(n) ? null : n;
  var diff = (it.qty === null || it.qty === undefined) ? null : (it.qty - it.previousQty);
  var diffEl = document.getElementById('diff-'+pid);
  if (diffEl) diffEl.innerHTML = window._diffBadgeHtml(diff);
  var wrap = document.getElementById('reasonwrap-'+pid);
  if (wrap) wrap.style.display = (diff !== null && diff !== 0) ? 'block' : 'none';
  var submitBtn = document.getElementById('submit-btn');
  if (submitBtn) {
    var allFilled = state.products.every(function(p){ var i2 = state.localItems[p.id]; return i2 && i2.qty !== null && i2.qty !== undefined; });
    submitBtn.disabled = !allFilled;
  }
  scheduleSave();
}
function updateReason(pid, val) {
  if (!state.localItems[pid]) return;
  state.localItems[pid].reason = val;
  scheduleSave();
}
function scheduleSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(async function() {
    try {
      await state.db.doc('counts/' + state.currentCount.id).update({ items: state.localItems });
    } catch(e) { /* silent retry on next change */ }
  }, 700);
}
async function submitCount() {
  clearTimeout(state.saveTimer);
  try {
    await state.db.doc('counts/' + state.currentCount.id).update({
      items: state.localItems,
      status: 'submitted',
      submittedBy: state.user.name,
      submittedAt: new Date().toISOString(),
    });
    showToast('Conteo enviado. Gracias!');
    await drawArea();
  } catch (e) {
    showToast('No se pudo enviar. Probá de nuevo.');
  }
}

// ---------- suggest new product ----------
function openSuggestProduct() {
  render(
    topbar() +
    '<main class="form-narrow-main">' +
      '<h2>Sugerir nuevo producto</h2>' +
      '<p class="sub">Quedará pendiente hasta que el manager lo apruebe.</p>' +
      '<div class="card">' +
        '<label class="field">Nombre del producto</label>' +
        '<input type="text" id="np-name" placeholder="Ej: Vaso Highball rallado">' +
        '<label class="field">Foto de referencia</label>' +
        '<label class="upload-label">📷 Elegir foto<input type="file" accept="image/*" id="np-photo" style="display:none" onchange="previewPhoto()"></label>' +
        '<div id="np-preview" style="margin-top:10px"></div>' +
      '</div>' +
      '<button class="btn btn-primary" id="suggest-btn" onclick="submitSuggestion()">Enviar sugerencia</button>' +
      '<button class="btn btn-secondary" style="margin-top:10px" onclick="renderAreaScreen()">Cancelar</button>' +
    '</main>'
  );
}
function previewPhoto() {
  var f = document.getElementById('np-photo').files[0];
  if (!f) return;
  var url = URL.createObjectURL(f);
  document.getElementById('np-preview').innerHTML = '<img src="'+url+'" style="width:80px;height:80px;object-fit:cover;border-radius:10px">';
}
function resizeImage(file, maxDim, quality) {
  return new Promise(function(resolve, reject) {
    var img = new Image();
    var reader = new FileReader();
    reader.onload = function(e) {
      img.onload = function() {
        var w = img.width, h = img.height;
        if (w > h && w > maxDim) { h = h * maxDim / w; w = maxDim; }
        else if (h > maxDim) { w = w * maxDim / h; h = maxDim; }
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(function(blob){ resolve(blob); }, 'image/jpeg', quality);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
async function submitSuggestion() {
  var name = document.getElementById('np-name').value.trim();
  var file = document.getElementById('np-photo').files[0];
  if (!name) { showToast('Ingresá un nombre'); return; }
  var btn = document.getElementById('suggest-btn');
  btn.disabled = true; btn.textContent = 'Enviando…';
  var photoId = null;
  if (file) {
    try {
      showToast('Subiendo foto…');
      var resized = await withTimeout(resizeImage(file, 640, 0.72), 15000, 'procesando la foto');
      var up = await withTimeout(state.assets.upload(resized, { type: 'image/jpeg' }), 20000, 'subiendo la foto');
      photoId = up.id;
    } catch (e) {
      console.error('Error subiendo foto de sugerencia:', e);
      showToast('No se pudo subir la foto, se guarda sin foto (' + (e.code || e.message) + ')');
    }
  }
  try {
    await withTimeout(state.db.collection('products').add({
      name: name, area: state.user.area, status: 'pending', photoId: photoId,
      suggestedBy: state.user.name, createdAt: new Date().toISOString(),
    }), 15000, 'guardando la sugerencia');
    showToast('Sugerencia enviada');
    await drawArea();
  } catch (e) {
    console.error('Error enviando sugerencia:', e);
    btn.disabled = false; btn.textContent = 'Enviar sugerencia';
    showToast('No se pudo enviar (' + (e.code || e.message) + ')');
  }
}

// ---------- edit product (encargado: nombre, descripción, foto) ----------
function openEditProduct(id) {
  var p = state.products.find(function (x) { return x.id === id; });
  if (!p) { showToast('No se encontró el producto'); return; }
  render(
    topbar() +
    '<main class="form-narrow-main">' +
      '<h2>Editar producto</h2>' +
      '<p class="sub">Los cambios se guardan al instante para todo el equipo.</p>' +
      '<div class="card">' +
        '<label class="field">Nombre</label>' +
        '<input type="text" id="ep-name" value="'+esc(p.name)+'">' +
        '<label class="field">Descripción / referencia (opcional)</label>' +
        '<input type="text" id="ep-uso" value="'+esc(p.uso || '')+'" placeholder="Ej: Tierra/Brasa">' +
        '<label class="field">Foto</label>' +
        '<div style="display:flex;align-items:center;gap:12px">' +
          '<div class="thumb" id="ep-preview">'+(p.photoId ? '<img src="'+photoUrl(p.photoId)+'">' : '📦')+'</div>' +
          '<label class="upload-label" style="flex:1">📷 Cambiar foto<input type="file" accept="image/*" id="ep-photo" style="display:none" onchange="previewEditPhoto()"></label>' +
        '</div>' +
      '</div>' +
      '<button class="btn btn-primary" id="ep-save-btn" onclick="saveProductEdit(\''+id+'\')">Guardar cambios</button>' +
      '<button class="btn btn-secondary" style="margin-top:10px" onclick="renderAreaScreen()">Cancelar</button>' +
    '</main>'
  );
}
function previewEditPhoto() {
  var f = document.getElementById('ep-photo').files[0];
  if (!f) return;
  var url = URL.createObjectURL(f);
  document.getElementById('ep-preview').innerHTML = '<img src="'+url+'">';
}
async function saveProductEdit(id) {
  var btn = document.getElementById('ep-save-btn');
  var name = document.getElementById('ep-name').value.trim();
  var uso = document.getElementById('ep-uso').value.trim();
  var file = document.getElementById('ep-photo').files[0];
  if (!name) { showToast('Ingresá un nombre'); return; }
  btn.disabled = true; btn.textContent = 'Guardando…';
  var update = { name: name, uso: uso || null };
  try {
    if (file) {
      showToast('Subiendo foto…');
      var resized = await withTimeout(resizeImage(file, 640, 0.72), 15000, 'procesando la foto');
      var up = await withTimeout(state.assets.upload(resized, { type: 'image/jpeg' }), 20000, 'subiendo la foto');
      update.photoId = up.id;
    }
    await withTimeout(state.db.doc('products/' + id).update(update), 15000, 'guardando los cambios');
    showToast('Producto actualizado');
    await drawArea();
  } catch (e) {
    console.error('Error editando producto:', e);
    btn.disabled = false; btn.textContent = 'Guardar cambios';
    showToast('No se pudo guardar (' + (e.code || e.message) + ')');
  }
}

// ---------- ADMIN SCREEN ----------
async function drawAdmin() {
  renderAdminShell();
}
function renderAdminShell() {
  var tabs = [['revisar','Revisar conteos'],['pendientes','Productos'],['personal','Personal'],['catalogo','Catálogo'],['historial','Historial']];
  var tabHtml = tabs.map(function(t){
    return '<div class="tab'+(state.adminTab===t[0]?' active':'')+'" onclick="switchAdminTab(\''+t[0]+'\')" data-tab="'+t[0]+'">'+t[1]+'</div>';
  }).join('');
  render(
    topbar() +
    '<main>' +
      '<h1>Panel de administración</h1>' +
      '<div class="tabs" id="admin-tabs">'+tabHtml+'</div>' +
      '<div id="admin-content"><div class="spinner"></div></div>' +
    '</main>'
  );
  var activeTab = document.querySelector('.tab.active');
  if (activeTab) activeTab.scrollIntoView({ block: 'nearest', inline: 'center' });
  loadAdminTab();
}
function switchAdminTab(t) { state.adminTab = t; renderAdminShell(); }

async function loadAdminTab() {
  var c = document.getElementById('admin-content');
  try {
    if (state.adminTab === 'revisar') return await renderRevisar(c);
    if (state.adminTab === 'pendientes') return await renderPendientes(c);
    if (state.adminTab === 'personal') return await renderPersonal(c);
    if (state.adminTab === 'catalogo') return await renderCatalogo(c);
    if (state.adminTab === 'historial') return await renderHistorial(c);
  } catch (e) {
    console.error('Error cargando pestaña:', e);
    c.innerHTML = '<div class="empty"><div class="icon">⚠️</div><p>No se pudieron cargar los datos (' + esc(e.code || e.message || 'error') + ').</p></div>';
  }
}

async function renderRevisar(c) {
  var snap = await state.db.collection('counts').where('status','==','submitted').get();
  var docs = snap.docs;
  if (docs.length === 0) { c.innerHTML = '<div class="empty"><div class="icon">✅</div><p>No hay conteos pendientes de revisión.</p></div>'; return; }
  var html = docs.map(function(d){
    var data = d.data();
    var diffs = Object.keys(data.items||{}).filter(function(pid){ var it=data.items[pid]; return it.qty !== it.previousQty; }).length;
    return (
      '<div class="card">' +
        '<h3>'+AREA_LABEL[data.area]+' — '+monthLabel(data.month)+'</h3>' +
        '<p class="pmeta" style="color:var(--text-secondary);font-size:13px">Enviado por '+esc(data.submittedBy||'-')+' · '+diffs+' producto(s) con diferencia</p>' +
        '<button class="btn btn-secondary btn-sm" style="width:100%;margin-top:10px" onclick="openReview(\''+d.id+'\')">Revisar</button>' +
      '</div>'
    );
  }).join('');
  c.innerHTML = '<div class="cards-grid">' + html + '</div>';
}

async function openReview(countId) {
  var snap = await state.db.doc('counts/' + countId).get();
  var data = snap.data();
  var prodSnap = await state.db.collection('products').where('area','==',data.area).get();
  var prodMap = {};
  prodSnap.docs.forEach(function(d){ prodMap[d.id] = d.data(); });

  var rows = Object.keys(data.items||{}).map(function(pid){
    var it = data.items[pid];
    var p = prodMap[pid] || { name: '(producto eliminado)' };
    var diff = (typeof it.qty === 'number') ? it.qty - it.previousQty : 0;
    var diffBadge = diff === 0 ? '<span class="badge badge-ok">Sin cambios</span>' : (diff > 0 ? '<span class="badge badge-ok">+'+diff+'</span>' : '<span class="badge badge-danger">'+diff+'</span>');
    return (
      '<div class="product-row">' +
        '<div class="thumb">'+(p.photoId ? '<img src="'+photoUrl(p.photoId)+'">' : '📦')+'</div>' +
        '<div class="product-info">' +
          '<div class="pname">'+esc(p.name)+'</div>' +
          '<div class="pmeta">Anterior '+it.previousQty+' → Actual '+it.qty+' '+diffBadge+(it.reason?'<br><span style="font-style:italic">"'+esc(it.reason)+'"</span>':'')+'</div>' +
        '</div>' +
      '</div>'
    );
  }).join('');

  render(
    topbar() +
    '<main>' +
      '<h2>'+AREA_LABEL[data.area]+' — '+monthLabel(data.month)+'</h2>' +
      '<p class="sub">Enviado por '+esc(data.submittedBy||'-')+'</p>' +
      '<div class="card product-grid">'+rows+'</div>' +
      '<div class="form-narrow"><label class="field">Nota (opcional, para devolver)</label>' +
      '<textarea id="review-note" rows="2" placeholder="Ej: revisá el conteo de tenedores"></textarea>' +
      '<div class="row" style="margin-top:16px">' +
        '<button class="btn btn-secondary" onclick="returnCount(\''+countId+'\')">Devolver</button>' +
        '<button class="btn btn-primary" onclick="approveCount(\''+countId+'\')">Aprobar</button>' +
      '</div>' +
      '<button class="btn btn-secondary" style="margin-top:10px" onclick="renderAdminShell()">Volver</button></div>' +
    '</main>'
  );
}
async function approveCount(countId) {
  try {
    await state.db.doc('counts/' + countId).update({ status: 'approved', reviewedBy: state.user.name, reviewedAt: new Date().toISOString() });
    showToast('Conteo aprobado');
    renderAdminShell();
  } catch (e) {
    console.error('Error aprobando conteo:', e);
    showToast('No se pudo aprobar (' + (e.code || e.message) + ')');
  }
}
async function returnCount(countId) {
  var note = document.getElementById('review-note').value.trim();
  try {
    await state.db.doc('counts/' + countId).update({ status: 'returned', managerNote: note, reviewedBy: state.user.name, reviewedAt: new Date().toISOString() });
    showToast('Conteo devuelto al encargado');
    renderAdminShell();
  } catch (e) {
    console.error('Error devolviendo conteo:', e);
    showToast('No se pudo devolver (' + (e.code || e.message) + ')');
  }
}

async function renderPendientes(c) {
  var snap = await state.db.collection('products').where('status','==','pending').get();
  var docs = snap.docs;
  if (docs.length === 0) { c.innerHTML = '<div class="empty"><div class="icon">🗂️</div><p>No hay productos pendientes de aprobación.</p></div>'; return; }
  var html = docs.map(function(d){
    var p = d.data();
    return (
      '<div class="card">' +
        '<div class="product-row" style="border:none;padding:0">' +
          '<div class="thumb">'+(p.photoId ? '<img src="'+photoUrl(p.photoId)+'">' : '📦')+'</div>' +
          '<div class="product-info">' +
            '<div class="pname">'+esc(p.name)+'</div>' +
            '<div class="pmeta">'+AREA_LABEL[p.area]+' · sugerido por '+esc(p.suggestedBy||'-')+'</div>' +
          '</div>' +
        '</div>' +
        '<div class="row" style="margin-top:12px">' +
          '<button class="btn btn-secondary btn-sm" style="width:100%" onclick="rejectProduct(\''+d.id+'\')">Rechazar</button>' +
          '<button class="btn btn-primary btn-sm" style="width:100%" onclick="approveProduct(\''+d.id+'\')">Aprobar</button>' +
        '</div>' +
      '</div>'
    );
  }).join('');
  c.innerHTML = '<div class="cards-grid">' + html + '</div>';
}
async function approveProduct(id) {
  try {
    await state.db.doc('products/' + id).update({ status: 'approved' });
    showToast('Producto aprobado');
    loadAdminTab();
  } catch (e) {
    console.error('Error aprobando producto:', e);
    showToast('No se pudo aprobar (' + (e.code || e.message) + ')');
  }
}
async function rejectProduct(id) {
  try {
    await state.db.doc('products/' + id).update({ status: 'rejected' });
    showToast('Producto rechazado');
    loadAdminTab();
  } catch (e) {
    console.error('Error rechazando producto:', e);
    showToast('No se pudo rechazar (' + (e.code || e.message) + ')');
  }
}

async function renderPersonal(c) {
  var snap = await state.db.collection('staff').where('active','==',true).get();
  var docs = snap.docs;
  var rows = docs.map(function(d){
    var s = d.data();
    var roleLabel = s.role === 'admin' ? 'Administrador' : AREA_LABEL[s.area] + ' · Encargado';
    return (
      '<div class="list-item">' +
        '<div><div class="pname" style="font-size:15px;font-weight:500">'+esc(s.name)+'</div><div class="pmeta" style="font-size:12px;color:var(--text-secondary)">'+roleLabel+' · PIN '+esc(s.pin)+'</div></div>' +
        '<button class="btn btn-secondary btn-sm" onclick="deactivateStaff(\''+d.id+'\')">Quitar</button>' +
      '</div>'
    );
  }).join('');
  c.innerHTML =
    '<div class="content-narrow"><div class="card">' + (rows || '<p class="sub" style="margin:0">Sin personal cargado.</p>') + '</div>' +
    '<button class="btn btn-primary" onclick="openAddStaff()">+ Agregar persona</button></div>';
}
function openAddStaff() {
  var c = document.getElementById('admin-content');
  var areaOpts = AREAS.map(function(a){ return '<option value="'+a+'">'+AREA_LABEL[a]+'</option>'; }).join('');
  c.innerHTML =
    '<div class="form-narrow"><div class="card">' +
      '<label class="field">Nombre</label>' +
      '<input type="text" id="as-name" placeholder="Ej: Sofía">' +
      '<label class="field">PIN de 4 dígitos</label>' +
      '<input type="tel" id="as-pin" maxlength="4" placeholder="0000">' +
      '<label class="field">Rol</label>' +
      '<select id="as-role" onchange="document.getElementById(\'as-area-wrap\').style.display = this.value===\'area\' ? \'block\' : \'none\'">' +
        '<option value="area">Encargado de área</option><option value="admin">Administrador</option>' +
      '</select>' +
      '<div id="as-area-wrap"><label class="field">Área</label><select id="as-area">'+areaOpts+'</select></div>' +
    '</div>' +
    '<button class="btn btn-primary" onclick="saveStaff()">Guardar</button>' +
    '<button class="btn btn-secondary" style="margin-top:10px" onclick="renderPersonal(document.getElementById(\'admin-content\'))">Cancelar</button></div>';
}
async function saveStaff() {
  var name = document.getElementById('as-name').value.trim();
  var pin = document.getElementById('as-pin').value.trim();
  var role = document.getElementById('as-role').value;
  var area = role === 'area' ? document.getElementById('as-area').value : null;
  if (!name || !/^\d{4}$/.test(pin)) { showToast('Completá nombre y PIN de 4 dígitos'); return; }
  try {
    var existing = await state.db.collection('staff').where('pin','==',pin).where('active','==',true).limit(1).get();
    if (!existing.empty) { showToast('Ese PIN ya está en uso'); return; }
    await state.db.collection('staff').add({ name: name, pin: pin, role: role, area: area, active: true, createdAt: new Date().toISOString() });
    showToast('Persona agregada');
    renderPersonal(document.getElementById('admin-content'));
  } catch (e) {
    console.error('Error guardando persona:', e);
    showToast('No se pudo guardar (' + (e.code || e.message) + ')');
  }
}
async function deactivateStaff(id) {
  try {
    await state.db.doc('staff/' + id).update({ active: false });
    showToast('Persona quitada');
    renderPersonal(document.getElementById('admin-content'));
  } catch (e) {
    console.error('Error quitando persona:', e);
    showToast('No se pudo quitar (' + (e.code || e.message) + ')');
  }
}

async function renderCatalogo(c) {
  var areaOpts = AREAS.map(function(a){ return '<option value="'+a+'">'+AREA_LABEL[a]+'</option>'; }).join('');
  var snap = await state.db.collection('products').where('status','==','approved').get();
  var docs = snap.docs.sort(function(a,b){
    var da = a.data(), db_ = b.data();
    return AREAS.indexOf(da.area) - AREAS.indexOf(db_.area) || da.name.localeCompare(db_.name);
  });
  var rows = docs.map(function(d){
    var p = d.data();
    return (
      '<div class="product-row">' +
        '<div class="thumb" style="cursor:pointer" onclick="changeProductPhoto(\''+d.id+'\')">'+(p.photoId ? '<img src="'+photoUrl(p.photoId)+'">' : '📦')+'</div>' +
        '<div class="product-info"><div class="pname">'+esc(p.name)+'</div><div class="pmeta">'+AREA_LABEL[p.area]+(p.uso ? ' · '+esc(p.uso) : '')+(p.photoId ? '' : ' · sin foto')+'</div></div>' +
        '<button class="btn btn-secondary btn-sm" title="Cambiar foto" onclick="changeProductPhoto(\''+d.id+'\')">📷</button>' +
        '<button class="btn btn-secondary btn-sm" onclick="removeProduct(\''+d.id+'\')">Quitar</button>' +
      '</div>'
    );
  }).join('');
  c.innerHTML =
    '<div class="split">' +
    '<div class="card">' +
      '<h3>Agregar producto directo</h3>' +
      '<label class="field">Nombre</label>' +
      '<input type="text" id="cp-name" placeholder="Ej: Copa de vino">' +
      '<label class="field">Área</label>' +
      '<select id="cp-area">'+areaOpts+'</select>' +
      '<label class="field">Foto</label>' +
      '<label class="upload-label">📷 Elegir foto<input type="file" accept="image/*" id="cp-photo" style="display:none" onchange="previewCatalogPhoto()"></label>' +
      '<div id="cp-preview" style="margin-top:10px"></div>' +
      '<button class="btn btn-primary" id="cp-add-btn" style="margin-top:14px" onclick="addCatalogProduct()">Agregar</button>' +
    '</div>' +
    '<div class="card product-grid">' + (rows || '<p class="sub" style="margin:0">Sin productos en el catálogo.</p>') + '</div>' +
    '</div>';
}
function previewCatalogPhoto() {
  var f = document.getElementById('cp-photo').files[0];
  if (!f) return;
  var url = URL.createObjectURL(f);
  document.getElementById('cp-preview').innerHTML = '<img src="'+url+'" style="width:80px;height:80px;object-fit:cover;border-radius:10px">';
}
async function addCatalogProduct() {
  var name = document.getElementById('cp-name').value.trim();
  var area = document.getElementById('cp-area').value;
  var file = document.getElementById('cp-photo').files[0];
  if (!name) { showToast('Ingresá un nombre'); return; }
  var btn = document.getElementById('cp-add-btn');
  btn.disabled = true; btn.textContent = 'Agregando…';
  var photoId = null;
  if (file) {
    try {
      showToast('Subiendo foto…');
      var resized = await withTimeout(resizeImage(file, 640, 0.72), 15000, 'procesando la foto');
      var up = await withTimeout(state.assets.upload(resized, { type: 'image/jpeg' }), 20000, 'subiendo la foto');
      photoId = up.id;
    } catch(e) {
      console.error('Error subiendo foto:', e);
      showToast('No se pudo subir la foto (' + (e.code || e.message) + ')');
    }
  }
  try {
    await withTimeout(state.db.collection('products').add({ name: name, area: area, status: 'approved', photoId: photoId, createdAt: new Date().toISOString() }), 15000, 'guardando el producto');
    showToast('Producto agregado');
    renderCatalogo(document.getElementById('admin-content'));
  } catch (e) {
    console.error('Error agregando producto:', e);
    btn.disabled = false; btn.textContent = 'Agregar';
    showToast('No se pudo agregar (' + (e.code || e.message) + ')');
  }
}
function changeProductPhoto(id) {
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async function() {
    var f = input.files[0];
    if (!f) return;
    showToast('Subiendo foto…');
    try {
      var resized = await withTimeout(resizeImage(f, 640, 0.72), 15000, 'procesando la foto');
      var up = await withTimeout(state.assets.upload(resized, { type: 'image/jpeg' }), 20000, 'subiendo la foto');
      await withTimeout(state.db.doc('products/' + id).update({ photoId: up.id }), 15000, 'guardando la foto');
      showToast('Foto actualizada');
      renderCatalogo(document.getElementById('admin-content'));
    } catch (e) {
      console.error('Error subiendo foto:', e);
      showToast('No se pudo subir la foto (' + (e.code || e.message) + ')');
    }
  };
  input.click();
}
async function removeProduct(id) {
  try {
    await state.db.doc('products/' + id).update({ status: 'rejected' });
    showToast('Producto quitado del catálogo');
    renderCatalogo(document.getElementById('admin-content'));
  } catch (e) {
    console.error('Error quitando producto:', e);
    showToast('No se pudo quitar (' + (e.code || e.message) + ')');
  }
}

async function renderHistorial(c) {
  var snap = await state.db.collection('counts').where('status','==','approved').get();
  var docs = snap.docs.slice().sort(function(a,b){
    var ma = a.data().month, mb = b.data().month;
    return ma < mb ? 1 : (ma > mb ? -1 : 0);
  }).slice(0, 36);
  if (docs.length === 0) { c.innerHTML = '<div class="empty"><div class="icon">🗄️</div><p>Todavía no hay conteos aprobados.</p></div>'; return; }
  var html = docs.map(function(d){
    var data = d.data();
    var totalDiff = 0;
    Object.keys(data.items||{}).forEach(function(pid){ var it = data.items[pid]; if (typeof it.qty==='number') totalDiff += (it.qty - it.previousQty); });
    return (
      '<div class="list-item">' +
        '<div><div class="pname" style="font-size:15px;font-weight:500">'+AREA_LABEL[data.area]+' — '+monthLabel(data.month)+'</div><div class="pmeta" style="font-size:12px;color:var(--text-secondary)">Aprobado por '+esc(data.reviewedBy||'-')+'</div></div>' +
        '<span class="badge '+(totalDiff<0?'badge-danger':'badge-ok')+'">'+(totalDiff>=0?'+':'')+totalDiff+'</span>' +
      '</div>'
    );
  }).join('');
  c.innerHTML = '<div class="card content-narrow">'+html+'</div>';
}

// ---------- dispatcher ----------
async function draw() {
  if (state.screen === 'loading') { render('<div class="center-screen"><div class="spinner"></div></div>'); return; }
  if (state.screen === 'bootstrap') return drawBootstrap();
  if (state.screen === 'login') return drawLogin();
  if (state.screen === 'area') return drawArea();
  if (state.screen === 'admin') return drawAdmin();
}

// init() se llama desde index.html una vez que Firebase está listo

const DAYS = ["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
const STORAGE_KEY = "mes-14-repas-semaine-v2";
const fmt = new Intl.NumberFormat("fr-FR", {style:"currency", currency:"EUR"});
const qtyFmt = (n) => {
  const rounded = Math.round(n * 10) / 10;
  return rounded % 1 === 0 ? rounded.toString() : rounded.toString().replace(".", ",");
};

let CATS = [];
let week = new Array(14).fill(null);
const expandedSlots = new Set();

function loadWeek(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){
      const parsed = JSON.parse(raw);
      if(Array.isArray(parsed) && parsed.length === 14) return parsed;
    }
  } catch(e) {}
  return new Array(14).fill(null);
}
function saveWeek(){
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(week)); } catch(e) {}
}

function getCat(id){ return CATS.find(c => c.id === id); }
function countInCat(id){ return week.filter(s => s && s.catId === id).length; }
function shuffle(arr){
  for(let i = arr.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function addToWeek(catId, mealIdx){
  const cat = getCat(catId);
  if(countInCat(catId) >= cat.quota) return;
  const empty = week.findIndex(s => s === null);
  if(empty === -1) return;
  week[empty] = {catId, mealIdx, portions: 1};
  saveWeek();
  renderAll();
}
function removeFromWeek(slotIdx){
  week[slotIdx] = null;
  expandedSlots.delete(slotIdx);
  saveWeek();
  renderAll();
}
function rerollSlot(slotIdx){
  const slot = week[slotIdx];
  if(!slot) return;
  const cat = getCat(slot.catId);
  const used = week.filter((s, i) => s && s.catId === slot.catId && i !== slotIdx).map(s => s.mealIdx);
  let cands = cat.meals.map((_, i) => i).filter(i => i !== slot.mealIdx && !used.includes(i));
  if(cands.length === 0) cands = cat.meals.map((_, i) => i).filter(i => i !== slot.mealIdx);
  if(cands.length === 0) return;
  week[slotIdx] = {catId: slot.catId, mealIdx: cands[Math.floor(Math.random() * cands.length)], portions: slot.portions};
  saveWeek();
  renderAll();
}
function setPortions(slotIdx, delta){
  const slot = week[slotIdx];
  if(!slot) return;
  const next = Math.min(8, Math.max(1, (slot.portions || 1) + delta));
  slot.portions = next;
  saveWeek();
  renderAll();
}
function drawWeek(){
  let picks = [];
  CATS.forEach(cat => {
    const idxs = shuffle(cat.meals.map((_, i) => i)).slice(0, cat.quota);
    idxs.forEach(idx => picks.push({catId: cat.id, mealIdx: idx, portions: 1}));
  });
  week = shuffle(picks);
  expandedSlots.clear();
  saveWeek();
  renderAll();
}
function clearWeek(){
  week = new Array(14).fill(null);
  expandedSlots.clear();
  saveWeek();
  renderAll();
}

function renderCategories(){
  const root = document.getElementById("categories");
  const openIds = Array.from(root.querySelectorAll(".cat.open")).map(el => el.dataset.catId);
  root.innerHTML = CATS.map(cat => {
    const used = countInCat(cat.id);
    const isOpen = openIds.includes(cat.id);
    const cards = cat.meals.map((m, idx) => {
      const disabled = used >= cat.quota;
      return `<div class="meal-card">
        <p class="name">${m.name}</p>
        <p class="portion">${m.ingredients.map(i => qtyFmt(i.qty) + " " + i.unit + " " + i.name).join(", ")}</p>
        <p class="benefit">${m.benefit}</p>
        <div class="row">
          <span class="price">${fmt.format(m.pricePerPortion)}</span>
          <button class="btn add-btn" data-cat="${cat.id}" data-idx="${idx}" ${disabled ? "disabled" : ""}>${disabled ? "Quota atteint" : "Ajouter"}</button>
        </div>
      </div>`;
    }).join("");
    return `<div class="cat ${isOpen ? "open" : ""}" data-cat-id="${cat.id}">
      <button class="cat-head" type="button">
        <span class="name">${cat.name}</span>
        <span class="quota-badge" style="color:var(${cat.colorVar})">${used} sur ${cat.quota} / semaine</span>
        <span class="chevron">⌄</span>
      </button>
      <div class="cat-body">${cards}</div>
    </div>`;
  }).join("");
  root.querySelectorAll(".cat-head").forEach(btn => {
    btn.addEventListener("click", () => btn.closest(".cat").classList.toggle("open"));
  });
  root.querySelectorAll(".add-btn").forEach(btn => {
    btn.addEventListener("click", () => addToWeek(btn.dataset.cat, parseInt(btn.dataset.idx)));
  });
}

function renderWeek(){
  const listRoot = document.getElementById("week-list");
  const filled = week.filter(Boolean).length;
  if(filled === 0){
    listRoot.innerHTML = `<div class="empty-state">Aucun repas pour l'instant.<br>Touche Tirer la semaine en haut, ou ajoute des plats depuis l'onglet Choisir.</div>`;
    return;
  }
  listRoot.innerHTML = week.map((slot, i) => {
    const dayLabel = DAYS[Math.floor(i / 2)] + " " + (i % 2 === 0 ? "midi" : "soir");
    if(!slot){
      return `<div class="slot empty"><span class="day">${dayLabel}</span> à choisir</div>`;
    }
    const cat = getCat(slot.catId);
    const meal = cat.meals[slot.mealIdx];
    const portions = slot.portions || 1;
    const isExpanded = expandedSlots.has(i);
    const ingredientsHtml = meal.ingredients.map(ing => `<li>${qtyFmt(ing.qty * portions)} ${ing.unit} de ${ing.name}</li>`).join("");
    const recipeHtml = meal.recipe.map(step => `<li>${step}</li>`).join("");
    return `<div class="slot ${isExpanded ? "detail-open" : ""}">
      <div class="slot-top">
        <span class="day">${dayLabel}</span>
        <span class="info"><span class="tag" style="background:var(${cat.colorVar})">${cat.name}</span><span class="mname">${meal.name}</span></span>
        <span class="mprice">${fmt.format(meal.pricePerPortion * portions)}</span>
      </div>
      <div class="slot-controls">
        <div class="portion-stepper">
          <button data-slot="${i}" data-delta="-1" class="portion-btn" aria-label="Réduire le nombre de portions">−</button>
          <span class="count">${portions} portion${portions > 1 ? "s" : ""}</span>
          <button data-slot="${i}" data-delta="1" class="portion-btn" aria-label="Augmenter le nombre de portions">+</button>
        </div>
        <span class="slot-actions">
          <button data-slot="${i}" class="slot-reroll" aria-label="Changer ce repas">↻</button>
          <button data-slot="${i}" class="slot-remove" aria-label="Retirer ce repas">×</button>
          <button data-slot="${i}" class="slot-toggle" aria-label="Voir la recette"><span class="chevron">⌄</span></button>
        </span>
      </div>
      <div class="slot-detail">
        <p class="detail-label">Ingrédients pour ${portions} portion${portions > 1 ? "s" : ""}</p>
        <ul class="ingredient-list">${ingredientsHtml}</ul>
        <p class="detail-label">Recette</p>
        <ol class="recipe-list">${recipeHtml}</ol>
      </div>
    </div>`;
  }).join("");
  listRoot.querySelectorAll(".slot-remove").forEach(btn => btn.addEventListener("click", () => removeFromWeek(parseInt(btn.dataset.slot))));
  listRoot.querySelectorAll(".slot-reroll").forEach(btn => btn.addEventListener("click", () => rerollSlot(parseInt(btn.dataset.slot))));
  listRoot.querySelectorAll(".portion-btn").forEach(btn => btn.addEventListener("click", () => setPortions(parseInt(btn.dataset.slot), parseInt(btn.dataset.delta))));
  listRoot.querySelectorAll(".slot-toggle").forEach(btn => btn.addEventListener("click", () => {
    const idx = parseInt(btn.dataset.slot);
    if(expandedSlots.has(idx)) expandedSlots.delete(idx); else expandedSlots.add(idx);
    renderWeek();
  }));
}

function computeShoppingList(){
  const map = new Map();
  week.forEach(slot => {
    if(!slot) return;
    const meal = getCat(slot.catId).meals[slot.mealIdx];
    const portions = slot.portions || 1;
    meal.ingredients.forEach(ing => {
      const key = ing.name + "|" + ing.unit;
      const qty = ing.qty * portions;
      map.set(key, (map.get(key) || 0) + qty);
    });
  });
  return Array.from(map.entries()).map(([key, qty]) => {
    const [name, unit] = key.split("|");
    return {name, unit, qty};
  }).sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

function renderShoppingList(){
  const root = document.getElementById("shopping-list");
  const items = computeShoppingList();
  if(items.length === 0){
    root.innerHTML = `<div class="empty-state">Pas encore de repas dans ta semaine, donc rien à acheter pour l'instant.</div>`;
    return;
  }
  root.innerHTML = items.map((item, i) => `<li class="shopping-item" data-idx="${i}">
    <input type="checkbox" id="ing-${i}">
    <span class="ing-name">${item.name}</span>
    <span class="ing-qty">${qtyFmt(item.qty)} ${item.unit}</span>
  </li>`).join("");
  root.querySelectorAll(".shopping-item input").forEach(cb => {
    cb.addEventListener("change", () => cb.closest(".shopping-item").classList.toggle("checked", cb.checked));
  });
}

function renderSummary(){
  const filled = week.filter(Boolean).length;
  const total = week.reduce((s, slot) => slot ? s + getCat(slot.catId).meals[slot.mealIdx].pricePerPortion * (slot.portions || 1) : s, 0);
  document.getElementById("count-out").textContent = filled + " / 14";
  document.getElementById("cost-out").textContent = fmt.format(total);
}

function renderAll(){
  renderCategories();
  renderWeek();
  renderShoppingList();
  renderSummary();
}

function copyShoppingList(){
  const items = computeShoppingList();
  if(items.length === 0) return;
  const text = items.map(item => "- " + qtyFmt(item.qty) + " " + item.unit + " " + item.name).join("\n");
  const btn = document.getElementById("copy-list-btn");
  navigator.clipboard.writeText(text).then(() => {
    const original = btn.textContent;
    btn.textContent = "Copié";
    setTimeout(() => { btn.textContent = original; }, 1500);
  }).catch(() => {});
}

function initTabs(){
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => { b.classList.remove("active"); b.setAttribute("aria-selected", "false"); });
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      ["choisir", "semaine", "courses"].forEach(name => {
        document.getElementById("view-" + name).classList.toggle("hidden", btn.dataset.view !== name);
      });
    });
  });
}

async function init(){
  document.getElementById("draw-btn").addEventListener("click", drawWeek);
  document.getElementById("clear-btn").addEventListener("click", clearWeek);
  document.getElementById("copy-list-btn").addEventListener("click", copyShoppingList);
  initTabs();
  try {
    const res = await fetch("meals.json");
    const data = await res.json();
    CATS = data.categories;
  } catch(e) {
    document.getElementById("categories").innerHTML = `<div class="empty-state">Impossible de charger meals.json.<br>Cette application doit être servie par un serveur web (GitHub Pages, ou "python3 -m http.server" en local) plutôt qu'ouverte en double-cliquant sur le fichier.</div>`;
    return;
  }
  week = loadWeek();
  if(week.some(s => s && !CATS.some(c => c.id === s.catId))){
    week = new Array(14).fill(null);
  }
  renderAll();
}

init();

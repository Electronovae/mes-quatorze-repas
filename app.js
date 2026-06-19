// ─── Constantes ──────────────────────────────────────────────────────────────

const DAYS        = ["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
const STORAGE_KEY = "mes-14-repas-semaine-v2";
const FRIDGE_KEY  = "mes-14-repas-frigo-v2";       // [{name, qty, unit}]
const PROFILE_KEY = "mes-14-repas-profil-v2";      // {personnes, pathologies, age, sexe, poids, taille, activite}
const BREAKFASTS_KEY = "mes-14-repas-petitsdej";
const THEME_KEY   = "mes-14-repas-theme";

const fmt    = new Intl.NumberFormat("fr-FR", {style:"currency", currency:"EUR"});
const round1 = n => Math.round(n*10)/10;
const qtyFmt = n => { const r = round1(n); return (r%1===0 ? r : r.toString().replace(".",",")).toString(); };

const ACTIVITY_FACTORS = {
  sedentaire: {label:"Sédentaire (peu/pas de sport)", factor:1.2},
  legere:     {label:"Activité légère (1-3x/semaine)", factor:1.375},
  moderee:    {label:"Activité modérée (3-5x/semaine)", factor:1.55},
  intense:    {label:"Activité intense (6-7x/semaine)", factor:1.725},
};

const PATHOLOGIES_DEF = [
  {id:"hypertriglyceridemie", label:"Hypertriglycéridémie"},
  {id:"steatose-hepatique",   label:"Stéatose hépatique (NAFLD)"},
  {id:"diabete-type-2",       label:"Diabète type 2"},
  {id:"hta",                  label:"Hypertension artérielle"},
  {id:"obesite",              label:"Obésité / perte de poids"},
  {id:"hypercholesterolemie", label:"Hypercholestérolémie"},
];

// ─── État global ─────────────────────────────────────────────────────────────

let CATS        = [];
let INGREDIENTS = {};
let week        = new Array(14).fill(null);
let fridgeItems = [];
let profile     = {personnes:2, pathologies:[], age:null, sexe:"f", poids:null, taille:null, activite:"moderee"};
let selectedBreakfasts = new Set();
let fridgeFilterOn = false;
const expandedSlots = new Set();

// ─── Persistance ─────────────────────────────────────────────────────────────

function loadWeek(){
  try { const r=JSON.parse(localStorage.getItem(STORAGE_KEY)||"null"); if(Array.isArray(r)&&r.length===14) return r; } catch(e){}
  return new Array(14).fill(null);
}
function saveWeek(){ try{localStorage.setItem(STORAGE_KEY,JSON.stringify(week));}catch(e){} }

function loadFridge(){
  try { const r=JSON.parse(localStorage.getItem(FRIDGE_KEY)||"[]"); fridgeItems = Array.isArray(r)?r:[]; } catch(e){ fridgeItems=[]; }
}
function saveFridge(){ try{localStorage.setItem(FRIDGE_KEY,JSON.stringify(fridgeItems));}catch(e){} }

function loadProfile(){
  try { const r=JSON.parse(localStorage.getItem(PROFILE_KEY)||"null"); if(r) profile=Object.assign({},profile,r); } catch(e){}
}
function saveProfile(){ try{localStorage.setItem(PROFILE_KEY,JSON.stringify(profile));}catch(e){} }

function loadBreakfasts(){
  try { const r=JSON.parse(localStorage.getItem(BREAKFASTS_KEY)||"[]"); selectedBreakfasts=new Set(r); } catch(e){ selectedBreakfasts=new Set(); }
}
function saveBreakfasts(){ try{localStorage.setItem(BREAKFASTS_KEY,JSON.stringify([...selectedBreakfasts]));}catch(e){} }

function loadTheme(){
  let theme = null;
  try { theme = localStorage.getItem(THEME_KEY); } catch(e){}
  if(!theme) theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  applyTheme(theme);
}
function applyTheme(theme){
  document.documentElement.setAttribute("data-theme", theme);
  try{ localStorage.setItem(THEME_KEY, theme); }catch(e){}
  const btn = document.getElementById("theme-toggle");
  if(btn) btn.textContent = theme === "dark" ? "☀️" : "🌙";
}
function toggleTheme(){
  const current = document.documentElement.getAttribute("data-theme");
  applyTheme(current === "dark" ? "light" : "dark");
}

// ─── Frigo helpers ───────────────────────────────────────────────────────────

function normName(n){ return n.trim().toLowerCase(); }
function fridgeEntry(name){ return fridgeItems.find(f=>normName(f.name)===normName(name)); }

function setFridgeQty(name,qty,unit){
  const idx = fridgeItems.findIndex(f=>normName(f.name)===normName(name));
  if(qty<=0){ if(idx!==-1) fridgeItems.splice(idx,1); }
  else if(idx===-1){ fridgeItems.push({name:name.trim(),qty,unit}); }
  else { fridgeItems[idx].qty=qty; fridgeItems[idx].unit=unit; }
  saveFridge();
}
function removeFridgeItem(name){ fridgeItems=fridgeItems.filter(f=>normName(f.name)!==normName(name)); saveFridge(); }

// ─── Nutrition ────────────────────────────────────────────────────────────────

function nutriForIngredient(ing){
  const data = INGREDIENTS[ing.name];
  if(!data) return {kcal:0,glucides:0,proteines:0,lipides:0,fibres:0};
  const factor = data.per==="unite" ? ing.qty : ing.qty/100;
  return {
    kcal:      data.kcal      * factor,
    glucides:  data.glucides  * factor,
    proteines: data.proteines * factor,
    lipides:   data.lipides   * factor,
    fibres:    data.fibres    * factor,
  };
}
function nutriForMeal(meal,portions){
  const t = {kcal:0,glucides:0,proteines:0,lipides:0,fibres:0};
  meal.ingredients.forEach(ing=>{
    const n=nutriForIngredient({...ing,qty:ing.qty*portions});
    t.kcal+=n.kcal; t.glucides+=n.glucides; t.proteines+=n.proteines; t.lipides+=n.lipides; t.fibres+=n.fibres;
  });
  return {kcal:Math.round(t.kcal), glucides:round1(t.glucides), proteines:round1(t.proteines), lipides:round1(t.lipides), fibres:round1(t.fibres)};
}

// Mifflin-St Jeor : besoin calorique journalier estimé
function computeTDEE(){
  const {age,sexe,poids,taille,activite} = profile;
  if(!age||!poids||!taille) return null;
  const bmr = sexe==="h"
    ? 10*poids + 6.25*taille - 5*age + 5
    : 10*poids + 6.25*taille - 5*age - 161;
  const factor = (ACTIVITY_FACTORS[activite]||ACTIVITY_FACTORS.moderee).factor;
  return Math.round(bmr*factor);
}

// Calcule la portion individuelle suggérée pour un repas donné, selon l'objectif calorique du profil.
// Renvoie null si le profil est incomplet ou si le plat n'a pas de kcal connue.
function suggestedPortionFactor(meal){
  const tdee = computeTDEE();
  if(!tdee) return null;
  const hasBreakfast = selectedBreakfasts.size>0;
  const shareMain = hasBreakfast ? 0.375 : 0.5; // part du midi ou du soir dans la journée
  const targetKcal = tdee * shareMain;
  const baseKcal = nutriForMeal(meal,1).kcal;
  if(!baseKcal) return null;
  let factor = targetKcal / baseKcal;
  factor = Math.min(3, Math.max(0.5, factor));
  return Math.round(factor*2)/2; // arrondi au 0.5 le plus proche
}

// ─── Compatibilité frigo ──────────────────────────────────────────────────────

function mealFridgeCoverage(meal){
  let matched=0;
  let full=true;
  meal.ingredients.forEach(ing=>{
    const f=fridgeEntry(ing.name);
    if(f && f.qty>0){
      matched++;
      if(f.unit!==ing.unit || f.qty<ing.qty) full=false;
    } else {
      full=false;
    }
  });
  return {matched, total:meal.ingredients.length, full: full && meal.ingredients.length>0};
}

// ─── Semaine helpers ─────────────────────────────────────────────────────────

function getCat(id){ return CATS.find(c=>c.id===id); }
function countInCat(id){ return week.filter(s=>s&&s.catId===id).length; }
function shuffle(arr){ for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];} return arr; }

function defaultPortionsFor(meal){
  const sf = suggestedPortionFactor(meal);
  const base = sf || 1;
  return Math.min(8, Math.max(0.5, Math.round(profile.personnes*base*2)/2));
}

function addToWeek(catId,mealIdx){
  const cat=getCat(catId); if(countInCat(catId)>=cat.quota) return;
  const empty=week.findIndex(s=>s===null); if(empty===-1) return;
  const meal=cat.meals[mealIdx];
  week[empty]={catId,mealIdx,portions:defaultPortionsFor(meal)};
  saveWeek(); renderAll();
}
function removeFromWeek(slotIdx){ week[slotIdx]=null; expandedSlots.delete(slotIdx); saveWeek(); renderAll(); }
function rerollSlot(slotIdx){
  const slot=week[slotIdx]; if(!slot) return;
  const cat=getCat(slot.catId);
  const used=week.filter((s,i)=>s&&s.catId===slot.catId&&i!==slotIdx).map(s=>s.mealIdx);
  let cands=cat.meals.map((_,i)=>i).filter(i=>i!==slot.mealIdx&&!used.includes(i));
  if(!cands.length) cands=cat.meals.map((_,i)=>i).filter(i=>i!==slot.mealIdx);
  if(!cands.length) return;
  const newIdx=cands[Math.floor(Math.random()*cands.length)];
  week[slotIdx]={catId:slot.catId,mealIdx:newIdx,portions:defaultPortionsFor(cat.meals[newIdx])};
  saveWeek(); renderAll();
}
function setPortions(slotIdx,delta){
  const slot=week[slotIdx]; if(!slot) return;
  slot.portions=Math.min(8,Math.max(0.5,(slot.portions||1)+delta));
  saveWeek(); renderAll();
}
function drawWeek(){
  const mainCats = CATS.filter(c=>c.id!=="petits-dejeuners");
  let picks=[]; mainCats.forEach(cat=>{
    shuffle(cat.meals.map((_,i)=>i)).slice(0,cat.quota).forEach(idx=>picks.push({catId:cat.id,mealIdx:idx,portions:defaultPortionsFor(cat.meals[idx])}));
  });
  week=shuffle(picks); expandedSlots.clear(); saveWeek(); renderAll();
}
function clearWeek(){ week=new Array(14).fill(null); expandedSlots.clear(); saveWeek(); renderAll(); }

// ─── Rendu : catégories ───────────────────────────────────────────────────────

function renderCategories(){
  const root=document.getElementById("categories");
  const openIds=Array.from(root.querySelectorAll(".cat.open")).map(el=>el.dataset.catId);
  const mainCats=CATS.filter(c=>c.id!=="petits-dejeuners");
  const hasFridge = fridgeItems.length>0;

  root.innerHTML=mainCats.map(cat=>{
    const used=countInCat(cat.id);
    const isOpen=openIds.includes(cat.id);

    let mealsToShow = cat.meals.map((m,idx)=>({m,idx}));
    if(hasFridge){
      mealsToShow.sort((a,b)=>{
        const ca=mealFridgeCoverage(a.m), cb=mealFridgeCoverage(b.m);
        return (cb.matched/cb.total) - (ca.matched/ca.total);
      });
    }
    if(fridgeFilterOn && hasFridge){
      mealsToShow = mealsToShow.filter(({m})=>mealFridgeCoverage(m).full);
    }

    const cards=mealsToShow.map(({m,idx})=>{
      const disabled=used>=cat.quota;
      const matchesProfil = profile.pathologies.length===0 || (m.pathologies||[]).some(p=>profile.pathologies.includes(p));
      const cov = hasFridge ? mealFridgeCoverage(m) : null;
      const fridgeBadge = cov && cov.matched>0 ? `<span class="fridge-badge ${cov.full?"fridge-full":""}">${cov.full?"🧊 faisable maintenant":`🧊 ${cov.matched}/${cov.total} en stock`}</span>` : "";
      const profBadge = matchesProfil && profile.pathologies.length>0 ? `<span class="match-badge">✓ ton profil</span>` : "";
      return `<div class="meal-card ${matchesProfil&&profile.pathologies.length>0?"meal-match":""}">
        <div class="badge-row">${profBadge}${fridgeBadge}</div>
        <p class="name">${m.name}</p>
        <p class="portion">${m.ingredients.map(i=>qtyFmt(i.qty)+" "+i.unit+" "+i.name).join(", ")}</p>
        <p class="benefit">${m.benefit}</p>
        <div class="row">
          <span class="price">${fmt.format(m.pricePerPortion)}</span>
          <button class="btn add-btn" data-cat="${cat.id}" data-idx="${idx}" ${disabled?"disabled":""}>${disabled?"Quota atteint":"Ajouter"}</button>
        </div>
      </div>`;
    }).join("") || `<p class="empty-cat-state">Aucun plat ne correspond à ton frigo actuel dans cette catégorie.</p>`;

    return `<div class="cat ${isOpen?"open":""}" data-cat-id="${cat.id}">
      <button class="cat-head" type="button">
        <span class="name">${cat.name}</span>
        <span class="quota-badge" style="color:var(${cat.colorVar})">${used} sur ${cat.quota} / semaine</span>
        <span class="chevron">⌄</span>
      </button>
      <div class="cat-body">${cards}</div>
    </div>`;
  }).join("");

  root.querySelectorAll(".cat-head").forEach(btn=>btn.addEventListener("click",()=>btn.closest(".cat").classList.toggle("open")));
  root.querySelectorAll(".add-btn").forEach(btn=>btn.addEventListener("click",()=>addToWeek(btn.dataset.cat,parseInt(btn.dataset.idx))));
}

function renderFridgeFilterBar(){
  const root = document.getElementById("fridge-filter-bar");
  if(!root) return;
  if(fridgeItems.length===0){ root.innerHTML=""; return; }
  root.innerHTML = `<label class="fridge-filter-toggle">
    <input type="checkbox" id="fridge-filter-cb" ${fridgeFilterOn?"checked":""}>
    Ne montrer que les plats faisables avec mon frigo
  </label>`;
  document.getElementById("fridge-filter-cb").addEventListener("change",e=>{
    fridgeFilterOn = e.target.checked;
    renderCategories();
  });
}

// ─── Rendu : Ma semaine ───────────────────────────────────────────────────────

function renderWeek(){
  const listRoot=document.getElementById("week-list");
  const filled=week.filter(Boolean).length;
  const pjCat=CATS.find(c=>c.id==="petits-dejeuners");
  const pjSelected=pjCat?[...selectedBreakfasts].map(id=>pjCat.meals.find(m=>m.id===id)).filter(Boolean):[];

  if(filled===0&&pjSelected.length===0){
    listRoot.innerHTML=`<div class="empty-state">Aucun repas pour l'instant.<br>Touche Tirer la semaine en haut, ou ajoute des plats depuis l'onglet Choisir.</div>`;
    return;
  }

  let html=week.map((slot,i)=>{
    const dayLabel=DAYS[Math.floor(i/2)]+" "+(i%2===0?"midi":"soir");
    if(!slot) return `<div class="slot empty"><span class="day">${dayLabel}</span> à choisir</div>`;
    const cat=getCat(slot.catId); const meal=cat.meals[slot.mealIdx]; const portions=slot.portions||1;
    const isExpanded=expandedSlots.has(i);
    const nutri=nutriForMeal(meal,portions);
    const ingHtml=meal.ingredients.map(ing=>`<li>${qtyFmt(ing.qty*portions)} ${ing.unit} de ${ing.name}</li>`).join("");
    const recHtml=meal.recipe.map(step=>`<li>${step}</li>`).join("");
    return `<div class="slot ${isExpanded?"detail-open":""}">
      <div class="slot-top">
        <span class="day">${dayLabel}</span>
        <span class="info"><span class="tag" style="background:var(${cat.colorVar})">${cat.name}</span><span class="mname">${meal.name}</span></span>
        <span class="mprice">${fmt.format(meal.pricePerPortion*portions)}</span>
      </div>
      <div class="slot-controls">
        <div class="portion-stepper">
          <button data-slot="${i}" data-delta="-0.5" class="portion-btn" aria-label="Réduire">−</button>
          <span class="count">${qtyFmt(portions)} portion${portions>1?"s":""}</span>
          <button data-slot="${i}" data-delta="0.5" class="portion-btn" aria-label="Augmenter">+</button>
        </div>
        <span class="slot-actions">
          <button data-slot="${i}" class="slot-reroll" aria-label="Changer">↻</button>
          <button data-slot="${i}" class="slot-remove" aria-label="Retirer">×</button>
          <button data-slot="${i}" class="slot-toggle" aria-label="Recette"><span class="chevron">⌄</span></button>
        </span>
      </div>
      <div class="slot-detail">
        <div class="nutri-strip">
          <span>${nutri.kcal} kcal</span><span>${qtyFmt(nutri.proteines)}g prot.</span><span>${qtyFmt(nutri.glucides)}g glu.</span><span>${qtyFmt(nutri.lipides)}g lip.</span><span>${qtyFmt(nutri.fibres)}g fib.</span>
        </div>
        <p class="detail-label">Ingrédients pour ${qtyFmt(portions)} portion${portions>1?"s":""}</p>
        <ul class="ingredient-list">${ingHtml}</ul>
        <p class="detail-label">Recette</p>
        <ol class="recipe-list">${recHtml}</ol>
      </div>
    </div>`;
  }).join("");

  if(pjSelected.length>0){
    html+=`<div class="week-section-title">🌅 Petits déjeuners de la semaine</div>`;
    html+=pjSelected.map(m=>{
      const nutri=nutriForMeal(m,1);
      return `<div class="slot slot-pj">
        <div class="slot-top">
          <span class="info"><span class="tag" style="background:var(--cat-petits-dejeuners)">${m.name}</span></span>
          <span class="mprice">${fmt.format(m.pricePerPortion)}/j</span>
        </div>
        <div class="nutri-strip">
          <span>${nutri.kcal} kcal</span><span>${qtyFmt(nutri.proteines)}g prot.</span><span>${qtyFmt(nutri.glucides)}g glu.</span><span>${qtyFmt(nutri.lipides)}g lip.</span><span>${qtyFmt(nutri.fibres)}g fib.</span>
        </div>
      </div>`;
    }).join("");
  }

  listRoot.innerHTML=html;
  listRoot.querySelectorAll(".slot-remove").forEach(btn=>btn.addEventListener("click",()=>removeFromWeek(parseInt(btn.dataset.slot))));
  listRoot.querySelectorAll(".slot-reroll").forEach(btn=>btn.addEventListener("click",()=>rerollSlot(parseInt(btn.dataset.slot))));
  listRoot.querySelectorAll(".portion-btn").forEach(btn=>btn.addEventListener("click",()=>setPortions(parseInt(btn.dataset.slot),parseFloat(btn.dataset.delta))));
  listRoot.querySelectorAll(".slot-toggle").forEach(btn=>btn.addEventListener("click",()=>{
    const idx=parseInt(btn.dataset.slot);
    if(expandedSlots.has(idx)) expandedSlots.delete(idx); else expandedSlots.add(idx);
    renderWeek();
  }));
}

// ─── Liste de courses ─────────────────────────────────────────────────────────

function computeShoppingList(){
  const map=new Map();
  week.forEach(slot=>{
    if(!slot) return;
    const meal=getCat(slot.catId).meals[slot.mealIdx];
    const portions=slot.portions||1;
    meal.ingredients.forEach(ing=>{
      const key=normName(ing.name)+"|"+ing.unit;
      map.set(key,(map.get(key)||0)+ing.qty*portions);
    });
  });
  const pjCat=CATS.find(c=>c.id==="petits-dejeuners");
  if(pjCat){ [...selectedBreakfasts].forEach(id=>{
    const meal=pjCat.meals.find(m=>m.id===id); if(!meal) return;
    meal.ingredients.forEach(ing=>{
      const key=normName(ing.name)+"|"+ing.unit;
      map.set(key,(map.get(key)||0)+ing.qty*7);
    });
  });}
  return Array.from(map.entries()).map(([key,qty])=>{
    const [name,unit]=key.split("|");
    return {name:findRealName(name)||name, unit, qty};
  }).sort((a,b)=>a.name.localeCompare(b.name,"fr"));
}

function findRealName(normalized){
  for(const cat of CATS) for(const m of cat.meals) for(const ing of m.ingredients)
    if(normName(ing.name)===normalized) return ing.name;
  return null;
}

function fridgeStatus(ing){
  const f=fridgeEntry(ing.name);
  if(!f) return {status:"none",toBuy:ing.qty};
  if(f.unit!==ing.unit) return {status:"none",toBuy:ing.qty};
  if(f.qty>=ing.qty) return {status:"full",toBuy:0};
  return {status:"partial",toBuy:ing.qty-f.qty,inStock:f.qty};
}

function renderShoppingList(){
  const root=document.getElementById("shopping-list");
  const items=computeShoppingList();
  if(items.length===0){
    root.innerHTML=`<div class="empty-state">Pas encore de repas dans ta semaine.</div>`; return;
  }

  const toBuy   = items.filter(i=>fridgeStatus(i).status!=="full");
  const inStock = items.filter(i=>fridgeStatus(i).status==="full");
  const pct = items.length>0 ? Math.round(inStock.length/items.length*100) : 0;

  let html=`<div class="completion-bar-wrap">
    <div class="completion-bar-track"><div class="completion-bar-fill" style="width:${pct}%"></div></div>
    <span class="completion-label">${pct}% déjà en stock (${inStock.length}/${items.length})</span>
  </div>`;

  if(toBuy.length===0){
    html+=`<li class="shopping-all-stock">Tout est déjà dans ton frigo ! 🎉</li>`;
  } else {
    html+=toBuy.map((item,i)=>{
      const {status,toBuy:tb,inStock:stockQty}=fridgeStatus(item);
      const qtyLabel=status==="partial"
        ? `<span class="ing-qty partial">${qtyFmt(tb)} ${item.unit} <span class="in-stock-hint">(${qtyFmt(stockQty)} en stock)</span></span>`
        : `<span class="ing-qty">${qtyFmt(item.qty)} ${item.unit}</span>`;
      const safe=item.name.replace(/"/g,"&quot;");
      return `<li class="shopping-item" data-name="${safe}">
        <input type="checkbox" id="ing-${i}">
        <span class="ing-name">${item.name}</span>
        ${qtyLabel}
        <button class="to-fridge-btn" data-name="${safe}" data-qty="${item.qty}" data-unit="${item.unit}" title="Ajouter au frigo">🧊</button>
      </li>`;
    }).join("");
  }

  if(inStock.length>0){
    html+=`<li class="instock-section"><details>
      <summary class="instock-summary">Déjà en stock (${inStock.length})</summary>
      <ul class="instock-list">
        ${inStock.map(item=>{
          const f=fridgeEntry(item.name);
          const safe=item.name.replace(/"/g,"&quot;");
          return `<li class="instock-item">
            <span class="ing-name">${item.name}</span>
            <span class="ing-qty">${qtyFmt(item.qty)} ${item.unit}${f?` / stock : ${qtyFmt(f.qty)} ${f.unit}`:""}</span>
            <button class="from-fridge-btn" data-name="${safe}" title="Retirer du frigo">×</button>
          </li>`;
        }).join("")}
      </ul>
    </details></li>`;
  }

  root.innerHTML=html;
  root.querySelectorAll(".shopping-item input").forEach(cb=>cb.addEventListener("change",()=>cb.closest(".shopping-item").classList.toggle("checked",cb.checked)));
  root.querySelectorAll(".to-fridge-btn").forEach(btn=>btn.addEventListener("click",()=>{
    setFridgeQty(btn.dataset.name,parseFloat(btn.dataset.qty),btn.dataset.unit);
    renderFridge(); renderShoppingList();
  }));
  root.querySelectorAll(".from-fridge-btn").forEach(btn=>btn.addEventListener("click",()=>{
    removeFridgeItem(btn.dataset.name); renderFridge(); renderShoppingList();
  }));
}

function copyShoppingList(){
  const items=computeShoppingList().filter(i=>fridgeStatus(i).status!=="full");
  if(!items.length) return;
  const text=items.map(item=>{
    const {status,toBuy}=fridgeStatus(item);
    const q=status==="partial"?toBuy:item.qty;
    return "- "+qtyFmt(q)+" "+item.unit+" "+item.name;
  }).join("\n");
  const btn=document.getElementById("copy-list-btn");
  navigator.clipboard.writeText(text).then(()=>{ const o=btn.textContent; btn.textContent="Copié"; setTimeout(()=>btn.textContent=o,1500); }).catch(()=>{});
}

// ─── Frigo ────────────────────────────────────────────────────────────────────

function getAllIngredientNames(){
  const names=new Set();
  CATS.forEach(cat=>cat.meals.forEach(m=>m.ingredients.forEach(i=>names.add(i.name))));
  return [...names].sort((a,b)=>a.localeCompare(b,"fr"));
}

function renderFridge(){
  const listEl  = document.getElementById("frigo-list");
  const footerEl= document.getElementById("frigo-footer");
  const dl      = document.getElementById("frigo-datalist");
  if(!listEl) return;

  if(dl) dl.innerHTML=getAllIngredientNames().map(n=>`<option value="${n}">`).join("");

  if(fridgeItems.length===0){
    listEl.innerHTML="";
    footerEl.innerHTML=`<p class="frigo-empty">Ton frigo est vide. Ajoute ce que tu as déjà chez toi pour que ça se déduise de ta liste de courses, et pour voir des suggestions de plats.</p>`;
    return;
  }
  const sorted=[...fridgeItems].sort((a,b)=>a.name.localeCompare(b.name,"fr"));
  listEl.innerHTML=sorted.map(f=>{
    const safe=f.name.replace(/"/g,"&quot;");
    return `<li class="frigo-item">
      <span class="frigo-name">${f.name}</span>
      <div class="frigo-qty-row">
        <input type="number" class="frigo-qty-edit" data-name="${safe}" data-unit="${f.unit}" value="${f.qty}" min="0" step="any">
        <span class="frigo-unit-label">${f.unit}</span>
      </div>
      <button class="frigo-remove" data-name="${safe}" aria-label="Retirer">×</button>
    </li>`;
  }).join("");
  footerEl.innerHTML=`<button class="btn frigo-clear-btn" id="frigo-clear-btn">Vider le frigo</button>`;

  listEl.querySelectorAll(".frigo-qty-edit").forEach(input=>{
    input.addEventListener("change",()=>{
      const val=parseFloat(input.value);
      setFridgeQty(input.dataset.name, isNaN(val)?0:val, input.dataset.unit);
      renderFridge(); renderShoppingList(); renderCategories();
    });
  });
  listEl.querySelectorAll(".frigo-remove").forEach(btn=>btn.addEventListener("click",()=>{
    removeFridgeItem(btn.dataset.name); renderFridge(); renderShoppingList(); renderCategories();
  }));
  document.getElementById("frigo-clear-btn").addEventListener("click",()=>{
    if(confirm("Vider tout le frigo ?")){ fridgeItems=[]; saveFridge(); renderFridge(); renderShoppingList(); renderCategories(); }
  });
}

function handleFrigoAdd(){
  const input=document.getElementById("frigo-input");
  const qtyInput=document.getElementById("frigo-qty-input");
  const unitInput=document.getElementById("frigo-unit-input");
  const name=input.value.trim();
  const qty=parseFloat(qtyInput.value)||1;
  const unit=unitInput.value.trim()||"g";
  if(!name) return;
  setFridgeQty(name,qty,unit);
  input.value=""; qtyInput.value="";
  renderFridge(); renderShoppingList(); renderCategories();
}

// ─── Petits déjeuners ────────────────────────────────────────────────────────

function renderBreakfasts(){
  const root=document.getElementById("breakfasts-list");
  if(!root) return;
  const pjCat=CATS.find(c=>c.id==="petits-dejeuners");
  if(!pjCat){ root.innerHTML=`<p class="hint">Chargement…</p>`; return; }

  root.innerHTML=pjCat.meals.map(m=>{
    const checked=selectedBreakfasts.has(m.id);
    const nutri=nutriForMeal(m,1);
    const matchesProfil=profile.pathologies.length===0||(m.pathologies||[]).some(p=>profile.pathologies.includes(p));
    return `<label class="pj-card ${checked?"pj-checked":""} ${matchesProfil&&profile.pathologies.length>0?"meal-match":""}">
      <input type="checkbox" class="pj-checkbox" data-id="${m.id}" ${checked?"checked":""}>
      <div class="pj-info">
        <p class="pj-name">${m.name}</p>
        <p class="pj-benefit">${m.benefit}</p>
        <div class="pj-row">
          <span class="price">${fmt.format(m.pricePerPortion)}/j</span>
          <span class="pj-nutri">${nutri.kcal} kcal · ${qtyFmt(nutri.proteines)}g P · ${qtyFmt(nutri.glucides)}g G</span>
        </div>
      </div>
    </label>`;
  }).join("");

  root.querySelectorAll(".pj-checkbox").forEach(cb=>cb.addEventListener("change",()=>{
    if(cb.checked) selectedBreakfasts.add(cb.dataset.id); else selectedBreakfasts.delete(cb.dataset.id);
    saveBreakfasts();
    cb.closest("label").classList.toggle("pj-checked",cb.checked);
    renderWeek(); renderShoppingList();
  }));
}

// ─── Profil & préférences ─────────────────────────────────────────────────────

function renderProfile(){
  const root=document.getElementById("profile-content");
  if(!root) return;
  const tdee = computeTDEE();

  root.innerHTML=`
    <div class="profile-section">
      <p class="profile-label">Nombre de personnes (portions par défaut)</p>
      <div class="portion-stepper profile-stepper">
        <button id="pers-minus" class="portion-btn">−</button>
        <span class="count" id="pers-count">${profile.personnes} pers.</span>
        <button id="pers-plus" class="portion-btn">+</button>
      </div>
    </div>

    <div class="profile-section">
      <p class="profile-label">Mes pathologies / objectifs <span class="profile-hint">(filtre et met en avant les repas adaptés)</span></p>
      <div class="pathologies-grid">
        ${PATHOLOGIES_DEF.map(p=>`
          <label class="patho-chip ${profile.pathologies.includes(p.id)?"patho-active":""}">
            <input type="checkbox" class="patho-cb" data-id="${p.id}" ${profile.pathologies.includes(p.id)?"checked":""}> ${p.label}
          </label>
        `).join("")}
      </div>
    </div>

    <div class="profile-section">
      <p class="profile-label">Objectif calorique personnel <span class="profile-hint">(ajuste automatiquement la taille des portions)</span></p>
      <div class="stats-grid">
        <label class="stat-field">Âge<input type="number" id="stat-age" min="10" max="110" value="${profile.age??""}" placeholder="ans"></label>
        <label class="stat-field">Sexe
          <select id="stat-sexe">
            <option value="f" ${profile.sexe==="f"?"selected":""}>Femme</option>
            <option value="h" ${profile.sexe==="h"?"selected":""}>Homme</option>
          </select>
        </label>
        <label class="stat-field">Poids<input type="number" id="stat-poids" min="30" max="300" value="${profile.poids??""}" placeholder="kg"></label>
        <label class="stat-field">Taille<input type="number" id="stat-taille" min="100" max="250" value="${profile.taille??""}" placeholder="cm"></label>
      </div>
      <label class="stat-field stat-field-full">Niveau d'activité
        <select id="stat-activite">
          ${Object.entries(ACTIVITY_FACTORS).map(([k,v])=>`<option value="${k}" ${profile.activite===k?"selected":""}>${v.label}</option>`).join("")}
        </select>
      </label>
      ${tdee
        ? `<div class="tdee-result">Besoin estimé : <strong>${tdee} kcal/jour</strong>. Les portions de tes repas sont ajustées automatiquement vers cet objectif (méthode Mifflin-St Jeor).</div>`
        : `<div class="tdee-hint">Renseigne âge, poids et taille pour activer l'ajustement automatique des portions.</div>`
      }
      <p class="tdee-disclaimer">Estimation indicative, pas un avis médical personnalisé. En cas de pathologie, suis les recommandations de ton médecin ou diététicien.</p>
    </div>

    <div class="profile-section">
      <p class="profile-label">Apparence</p>
      <button class="btn" id="theme-toggle-profile">Basculer le thème clair / sombre</button>
    </div>
  `;

  document.getElementById("pers-minus").addEventListener("click",()=>{ profile.personnes=Math.max(1,profile.personnes-1); saveProfile(); renderProfile(); });
  document.getElementById("pers-plus").addEventListener("click",()=>{ profile.personnes=Math.min(12,profile.personnes+1); saveProfile(); renderProfile(); });
  root.querySelectorAll(".patho-cb").forEach(cb=>cb.addEventListener("change",()=>{
    if(cb.checked){ if(!profile.pathologies.includes(cb.dataset.id)) profile.pathologies.push(cb.dataset.id); }
    else { profile.pathologies=profile.pathologies.filter(p=>p!==cb.dataset.id); }
    saveProfile();
    cb.closest("label").classList.toggle("patho-active",cb.checked);
    renderCategories(); renderBreakfasts();
  }));
  ["age","poids","taille"].forEach(field=>{
    document.getElementById("stat-"+field).addEventListener("change",e=>{
      profile[field]=e.target.value?parseFloat(e.target.value):null;
      saveProfile(); renderProfile();
    });
  });
  document.getElementById("stat-sexe").addEventListener("change",e=>{ profile.sexe=e.target.value; saveProfile(); renderProfile(); });
  document.getElementById("stat-activite").addEventListener("change",e=>{ profile.activite=e.target.value; saveProfile(); renderProfile(); });
  document.getElementById("theme-toggle-profile").addEventListener("click", toggleTheme);
}

// ─── Summary ──────────────────────────────────────────────────────────────────

function renderSummary(){
  const filled=week.filter(Boolean).length;
  const total=week.reduce((s,slot)=>slot?s+getCat(slot.catId).meals[slot.mealIdx].pricePerPortion*(slot.portions||1):s,0);
  document.getElementById("count-out").textContent=filled+" / 14";
  document.getElementById("cost-out").textContent=fmt.format(total);
}

// ─── renderAll ────────────────────────────────────────────────────────────────

function renderAll(){
  renderCategories();
  renderFridgeFilterBar();
  renderWeek();
  renderShoppingList();
  renderSummary();
  renderFridge();
  renderBreakfasts();
  renderProfile();
}

// ─── Onglets ──────────────────────────────────────────────────────────────────

const ALL_VIEWS = ["choisir","semaine","courses","frigo","petitsdej","profil","sources"];

function initTabs(){
  document.querySelectorAll(".tab-btn").forEach(btn=>{
    btn.addEventListener("click",()=>{
      document.querySelectorAll(".tab-btn").forEach(b=>{b.classList.remove("active");b.setAttribute("aria-selected","false");});
      btn.classList.add("active"); btn.setAttribute("aria-selected","true");
      ALL_VIEWS.forEach(name=>document.getElementById("view-"+name).classList.toggle("hidden",btn.dataset.view!==name));
    });
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init(){
  loadTheme();
  document.getElementById("draw-btn").addEventListener("click", drawWeek);
  document.getElementById("clear-btn").addEventListener("click", clearWeek);
  document.getElementById("copy-list-btn").addEventListener("click", copyShoppingList);
  document.getElementById("frigo-add-btn").addEventListener("click", handleFrigoAdd);
  document.getElementById("frigo-input").addEventListener("keydown",e=>{ if(e.key==="Enter") handleFrigoAdd(); });
  const themeBtn = document.getElementById("theme-toggle");
  if(themeBtn) themeBtn.addEventListener("click", toggleTheme);
  initTabs();

  loadProfile();
  loadFridge();
  loadBreakfasts();

  try {
    const [mealsRes, ingRes] = await Promise.all([fetch("meals.json"), fetch("ingredients.json")]);
    const data = await mealsRes.json();
    INGREDIENTS = await ingRes.json();
    CATS = data.categories;
  } catch(e) {
    document.getElementById("categories").innerHTML=`<div class="empty-state">Impossible de charger les données.<br>Lance <code>python3 -m http.server</code> en local.</div>`;
    return;
  }

  week=loadWeek();
  if(week.some(s=>s&&!CATS.some(c=>c.id===s.catId))) week=new Array(14).fill(null);
  renderAll();
}

init();

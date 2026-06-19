// ─── Constantes ──────────────────────────────────────────────────────────────

const DAYS        = ["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
const STORAGE_KEY = "mes-14-repas-semaine-v2";
const FRIDGE_KEY  = "mes-14-repas-frigo-v2";       // [{name, qty, unit}]
const PROFILE_KEY = "mes-14-repas-profil-v2";      // {personnes, pathologies, age, sexe, poids, taille, activite}
const BREAKFASTS_KEY = "mes-14-repas-petitsdej";
const THEME_KEY   = "mes-14-repas-theme";
const SUIVI_KEY   = "mes-14-repas-suivi";    // {dateISO: {kcal,glucides,proteines,lipides,fibres}}
const WEIGHT_KEY  = "mes-14-repas-poids";    // {weekMondayISO: poidsKg}

const fmt    = new Intl.NumberFormat("fr-FR", {style:"currency", currency:"EUR"});
const round1 = n => Math.round(n*10)/10;
const qtyFmt = n => { const r = round1(n); return (r%1===0 ? r : r.toString().replace(".",",")).toString(); };

// Ingrédients "aromates/assaisonnement" : ne doivent pas grossir proportionnellement au nombre de portions.
// 2 portions ne veulent pas dire 2x plus d'oignon ou d'ail dans la poêle.
const AROMATIC_RE = /\boignons?\b|oignon rouge|\bail\b|gousse|gingembre|herbes?\b|épices?\b|curry|cumin|curcuma|paprika|persil|aneth|basilic|menthe|romarin|estragon|garam masala|piment|vinaigre|moutarde|cannelle|coriandre/i;
function isAromatic(name){ return AROMATIC_RE.test(name); }
function scaledQty(ing, portions){
  if(portions<=1 || !isAromatic(ing.name)) return ing.qty*portions;
  const extra = portions-1;
  return ing.qty*(1+extra*0.3); // montée douce au-delà d'1 portion
}

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
let profile     = {personnes:2, pathologies:[], age:null, sexe:"f", poids:null, taille:null, activite:"moderee", exclusions:[]};
let selectedBreakfasts = new Set();
let fridgeFilterOn = false;
let costMode = false;
let suiviLog = {};      // {dateISO: {kcal,glucides,proteines,lipides,fibres}}
let weightLog = {};     // {weekMondayISO: poidsKg}
let suiviPeriod = "7j";
let suiviView = "kcal";
let suiviMainChart = null;
let suiviWeightChart = null;
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

function loadSuivi(){
  try { suiviLog = JSON.parse(localStorage.getItem(SUIVI_KEY)||"{}"); } catch(e){ suiviLog={}; }
}
function saveSuivi(){ try{ localStorage.setItem(SUIVI_KEY, JSON.stringify(suiviLog)); }catch(e){} }
function loadWeightLog(){
  try { weightLog = JSON.parse(localStorage.getItem(WEIGHT_KEY)||"{}"); } catch(e){ weightLog={}; }
}
function saveWeightLog(){ try{ localStorage.setItem(WEIGHT_KEY, JSON.stringify(weightLog)); }catch(e){} }

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

function ingredientPrice(name, qty){
  const data = INGREDIENTS[name];
  if(!data || data.price==null) return 0;
  const factor = data.per==="unite" ? qty : qty/100;
  return data.price*factor;
}

// Coût plein d'un plat (toutes les portions, sans tenir compte du frigo)
function mealFullCost(meal, portions){
  let cost=0;
  meal.ingredients.forEach(ing=>cost+=ingredientPrice(ing.name, scaledQty(ing,portions)));
  return Math.round(cost*100)/100;
}

// Coût "à acheter" d'un plat pris isolément, en déduisant ce qu'il y a déjà au frigo.
// Approximation par plat (ne gère pas le partage du stock entre plusieurs plats, voir computeShoppingList pour l'agrégat exact).
function mealCostToBuy(meal, portions){
  let cost=0;
  meal.ingredients.forEach(ing=>{
    const qty=scaledQty(ing,portions);
    const f=fridgeEntry(ing.name);
    let toBuy=qty;
    if(f && f.unit===ing.unit) toBuy=Math.max(0, qty-f.qty);
    cost+=ingredientPrice(ing.name, toBuy);
  });
  return Math.round(cost*100)/100;
}
function nutriForMeal(meal,portions){
  const t = {kcal:0,glucides:0,proteines:0,lipides:0,fibres:0};
  meal.ingredients.forEach(ing=>{
    const n=nutriForIngredient({...ing,qty:scaledQty(ing,portions)});
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
  // Léger déficit si objectif perte de poids déclaré, plutôt que viser le maintien strict.
  const target = profile.pathologies.includes("obesite") ? tdee*0.85 : tdee;
  const hasBreakfast = selectedBreakfasts.size>0;
  const shareMain = hasBreakfast ? 0.375 : 0.5; // part du midi ou du soir dans la journée
  const targetKcal = target * shareMain;
  const baseKcal = nutriForMeal(meal,1).kcal;
  if(!baseKcal) return null;
  let factor = targetKcal / baseKcal;
  // Fourchette resserrée : les recettes sont déjà calibrées pour une portion adulte standard,
  // on ajuste modérément plutôt que de tripler les quantités.
  factor = Math.min(1.5, Math.max(0.75, factor));
  return Math.round(factor*4)/4;
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

function mealExcluded(meal){
  if(!profile.exclusions || !profile.exclusions.length) return false;
  return meal.ingredients.some(ing=>{
    const n=normName(ing.name);
    return profile.exclusions.some(excl=>n.includes(normName(excl)));
  });
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
  let cands=cat.meals.map((_,i)=>i).filter(i=>i!==slot.mealIdx&&!used.includes(i)&&!mealExcluded(cat.meals[i]));
  if(!cands.length) cands=cat.meals.map((_,i)=>i).filter(i=>i!==slot.mealIdx&&!mealExcluded(cat.meals[i]));
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
    let pool = cat.meals.map((_,i)=>i).filter(i=>!mealExcluded(cat.meals[i]));
    if(pool.length<cat.quota) pool = cat.meals.map((_,i)=>i); // pas assez de plats compatibles, on retombe sur tout
    let chosen;
    if(costMode){
      chosen = [...pool].sort((a,b)=>mealCostToBuy(cat.meals[a],1)-mealCostToBuy(cat.meals[b],1)).slice(0,cat.quota);
    } else {
      chosen = shuffle(pool).slice(0,cat.quota);
    }
    chosen.forEach(idx=>picks.push({catId:cat.id,mealIdx:idx,portions:defaultPortionsFor(cat.meals[idx])}));
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

    let mealsToShow = cat.meals.map((m,idx)=>({m,idx})).filter(({m})=>!mealExcluded(m));
    if(costMode){
      mealsToShow.sort((a,b)=>mealCostToBuy(a.m,1)-mealCostToBuy(b.m,1));
    } else if(hasFridge){
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
      const fullCost = mealFullCost(m,1);
      const toBuyCost = costMode ? mealCostToBuy(m,1) : null;
      const priceHtml = (costMode && toBuyCost!==fullCost)
        ? `<span class="price"><span class="price-strike">${fmt.format(fullCost)}</span> ${fmt.format(toBuyCost)} à acheter</span>`
        : `<span class="price">${fmt.format(fullCost)}</span>`;
      return `<div class="meal-card ${matchesProfil&&profile.pathologies.length>0?"meal-match":""}">
        <div class="badge-row">${profBadge}${fridgeBadge}</div>
        <p class="name">${m.name}</p>
        <p class="portion">${m.ingredients.map(i=>qtyFmt(i.qty)+" "+i.unit+" "+i.name).join(", ")}</p>
        <p class="benefit">${m.benefit}</p>
        <div class="row">
          ${priceHtml}
          <button class="btn add-btn" data-cat="${cat.id}" data-idx="${idx}" ${disabled?"disabled":""}>${disabled?"Quota atteint":"Ajouter"}</button>
        </div>
      </div>`;
    }).join("") || `<p class="empty-cat-state">Aucun plat disponible ici (exclusions alimentaires ou filtre frigo trop strict).</p>`;

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
  let html = `<label class="fridge-filter-toggle">
    <input type="checkbox" id="cost-mode-cb" ${costMode?"checked":""}>
    💰 Mode courses optimisées (priorise les moins chers, frigo déduit)
  </label>`;
  if(fridgeItems.length>0){
    html += `<label class="fridge-filter-toggle">
      <input type="checkbox" id="fridge-filter-cb" ${fridgeFilterOn?"checked":""}>
      🧊 Ne montrer que les plats faisables avec mon frigo
    </label>`;
  }
  root.innerHTML = html;
  document.getElementById("cost-mode-cb").addEventListener("change",e=>{
    costMode = e.target.checked;
    renderCategories();
  });
  const fridgeCb = document.getElementById("fridge-filter-cb");
  if(fridgeCb) fridgeCb.addEventListener("change",e=>{
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
    const ingHtml=meal.ingredients.map(ing=>`<li>${qtyFmt(scaledQty(ing,portions))} ${ing.unit} de ${ing.name}</li>`).join("");
    const recHtml=meal.recipe.map(step=>`<li>${step}</li>`).join("");
    return `<div class="slot ${isExpanded?"detail-open":""}">
      <div class="slot-top">
        <span class="day">${dayLabel}</span>
        <span class="info"><span class="tag" style="background:var(${cat.colorVar})">${cat.name}</span><span class="mname">${meal.name}</span></span>
        <span class="mprice">${fmt.format(mealFullCost(meal,portions))}</span>
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
          <span class="mprice">${fmt.format(mealFullCost(m,1))}/j</span>
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
      map.set(key,(map.get(key)||0)+scaledQty(ing,portions));
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

// Coût réel des courses restantes, calculé sur la liste agrégée (donc sans double-compter le frigo
// si plusieurs plats partagent le même ingrédient, contrairement à mealCostToBuy plat par plat).
function shoppingCostToBuy(){
  const items=computeShoppingList();
  let total=0;
  items.forEach(item=>{
    const {status,toBuy}=fridgeStatus(item);
    const qty = status==="full" ? 0 : toBuy;
    total+=ingredientPrice(item.name, qty);
  });
  return Math.round(total*100)/100;
}
function shoppingFullCost(){
  const items=computeShoppingList();
  let total=0;
  items.forEach(item=>total+=ingredientPrice(item.name, item.qty));
  return Math.round(total*100)/100;
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
  const costToBuy = shoppingCostToBuy();
  const fullCost = shoppingFullCost();
  const saved = Math.max(0, Math.round((fullCost-costToBuy)*100)/100);

  let html=`<div class="completion-bar-wrap">
    <div class="completion-bar-track"><div class="completion-bar-fill" style="width:${pct}%"></div></div>
    <span class="completion-label">${pct}% déjà en stock (${inStock.length}/${items.length})</span>
  </div>
  <div class="shopping-cost-summary">
    <span class="shopping-cost-main">Coût des courses : <strong>${fmt.format(costToBuy)}</strong></span>
    ${saved>0 ? `<span class="shopping-cost-saved">${fmt.format(saved)} économisés grâce au frigo</span>` : ""}
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
    renderFridge(); renderShoppingList(); renderSummary();
  }));
  root.querySelectorAll(".from-fridge-btn").forEach(btn=>btn.addEventListener("click",()=>{
    removeFridgeItem(btn.dataset.name); renderFridge(); renderShoppingList(); renderSummary();
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
      renderFridge(); renderShoppingList(); renderCategories(); renderSummary();
    });
  });
  listEl.querySelectorAll(".frigo-remove").forEach(btn=>btn.addEventListener("click",()=>{
    removeFridgeItem(btn.dataset.name); renderFridge(); renderShoppingList(); renderCategories(); renderSummary();
  }));
  document.getElementById("frigo-clear-btn").addEventListener("click",()=>{
    if(confirm("Vider tout le frigo ?")){ fridgeItems=[]; saveFridge(); renderFridge(); renderShoppingList(); renderCategories(); renderSummary(); }
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
  renderFridge(); renderShoppingList(); renderCategories(); renderSummary();
}

// ─── Petits déjeuners ────────────────────────────────────────────────────────

function renderBreakfasts(){
  const root=document.getElementById("breakfasts-list");
  if(!root) return;
  const pjCat=CATS.find(c=>c.id==="petits-dejeuners");
  if(!pjCat){ root.innerHTML=`<p class="hint">Chargement…</p>`; return; }

  root.innerHTML=pjCat.meals.filter(m=>!mealExcluded(m)).map(m=>{
    const checked=selectedBreakfasts.has(m.id);
    const nutri=nutriForMeal(m,1);
    const matchesProfil=profile.pathologies.length===0||(m.pathologies||[]).some(p=>profile.pathologies.includes(p));
    return `<label class="pj-card ${checked?"pj-checked":""} ${matchesProfil&&profile.pathologies.length>0?"meal-match":""}">
      <input type="checkbox" class="pj-checkbox" data-id="${m.id}" ${checked?"checked":""}>
      <div class="pj-info">
        <p class="pj-name">${m.name}</p>
        <p class="pj-benefit">${m.benefit}</p>
        <div class="pj-row">
          <span class="price">${fmt.format(mealFullCost(m,1))}/j</span>
          <span class="pj-nutri">${nutri.kcal} kcal · ${qtyFmt(nutri.proteines)}g P · ${qtyFmt(nutri.glucides)}g G</span>
        </div>
      </div>
    </label>`;
  }).join("");

  root.querySelectorAll(".pj-checkbox").forEach(cb=>cb.addEventListener("change",()=>{
    if(cb.checked) selectedBreakfasts.add(cb.dataset.id); else selectedBreakfasts.delete(cb.dataset.id);
    saveBreakfasts();
    cb.closest("label").classList.toggle("pj-checked",cb.checked);
    renderWeek(); renderShoppingList(); renderSummary();
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
      <p class="profile-label">Aliments à exclure <span class="profile-hint">(masque tous les plats qui en contiennent)</span></p>
      <div class="exclusion-add-row">
        <input id="exclusion-input" type="text" placeholder="Ex. : Oignon, Brocolis…" list="exclusion-datalist" class="frigo-input" autocomplete="off">
        <datalist id="exclusion-datalist">${getAllIngredientNames().map(n=>`<option value="${n}">`).join("")}</datalist>
        <button class="btn btn-primary" id="exclusion-add-btn">+</button>
      </div>
      <div class="exclusion-chips">
        ${(profile.exclusions||[]).map(e=>`<span class="exclusion-chip">${e}<button class="exclusion-remove" data-name="${e.replace(/"/g,"&quot;")}">×</button></span>`).join("") || `<p class="exclusion-empty">Aucune exclusion.</p>`}
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

  document.getElementById("exclusion-add-btn").addEventListener("click",()=>{
    const input=document.getElementById("exclusion-input");
    const val=input.value.trim();
    if(val && !(profile.exclusions||[]).some(e=>normName(e)===normName(val))){
      profile.exclusions=[...(profile.exclusions||[]),val];
      saveProfile();
      renderProfile(); renderCategories(); renderBreakfasts();
    }
    input.value="";
  });
  document.getElementById("exclusion-input").addEventListener("keydown",e=>{
    if(e.key==="Enter") document.getElementById("exclusion-add-btn").click();
  });
  root.querySelectorAll(".exclusion-remove").forEach(btn=>btn.addEventListener("click",()=>{
    profile.exclusions=(profile.exclusions||[]).filter(e=>e!==btn.dataset.name);
    saveProfile();
    renderProfile(); renderCategories(); renderBreakfasts();
  }));
}

// ─── Summary ──────────────────────────────────────────────────────────────────

// ─── Suivi ────────────────────────────────────────────────────────────────────

function isoDate(d){
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), day=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function mondayOf(d){
  const dt=new Date(d);
  const day=dt.getDay(); // 0=dimanche..6=samedi
  const diff=(day===0?-6:1-day);
  dt.setDate(dt.getDate()+diff);
  dt.setHours(0,0,0,0);
  return dt;
}
const DAY_LABELS_SHORT=["lun.","mar.","mer.","jeu.","ven.","sam.","dim."];

// Calcule le total nutritionnel planifié pour un jour de la semaine en cours (0=lundi..6=dimanche),
// à partir du plan actuel (week[]) et des petits-déj sélectionnés s'il y en a ce jour-là.
function plannedNutriForDayIndex(dayIdx){
  const slotsMidi=week[dayIdx*2], slotsSoir=week[dayIdx*2+1];
  const totals={kcal:0,glucides:0,proteines:0,lipides:0,fibres:0};
  [slotsMidi,slotsSoir].forEach(slot=>{
    if(!slot) return;
    const meal=getCat(slot.catId).meals[slot.mealIdx];
    const n=nutriForMeal(meal, slot.portions||1);
    totals.kcal+=n.kcal; totals.glucides+=n.glucides; totals.proteines+=n.proteines; totals.lipides+=n.lipides; totals.fibres+=n.fibres;
  });
  return totals;
}

// Coche/décoche un jour comme "mangé comme prévu". À la coche, on enregistre un instantané
// nutritionnel basé sur le plan du moment, qui ne bougera plus même si le plan change ensuite.
function toggleSuiviDay(dateISO, dayIdx, checked){
  if(checked){
    suiviLog[dateISO]=plannedNutriForDayIndex(dayIdx);
  } else {
    delete suiviLog[dateISO];
  }
  saveSuivi();
  renderSuivi();
}

function saveWeightEntry(){
  const input=document.getElementById("suivi-weight-input");
  const val=parseFloat(input.value);
  if(isNaN(val) || val<=0) return;
  const weekKey=isoDate(mondayOf(new Date()));
  weightLog[weekKey]=val;
  saveWeightLog();
  input.value="";
  renderSuivi();
}

function getPeriodDates(period){
  const today=new Date();
  if(period==="7j"){
    const dates=[];
    for(let i=6;i>=0;i--){ const d=new Date(today); d.setDate(d.getDate()-i); dates.push(d); }
    return dates;
  }
  const days = period==="4s" ? 28 : 90;
  const dates=[];
  for(let i=days-1;i>=0;i--){ const d=new Date(today); d.setDate(d.getDate()-i); dates.push(d); }
  return dates;
}

function renderSuiviLegend(){
  const el=document.getElementById("suivi-legend");
  if(!el) return;
  if(suiviView==="kcal"){
    el.innerHTML=`<span class="suivi-legend-item"><span class="suivi-legend-swatch" style="background:#1D9E75"></span>Apport réel</span>
      <span class="suivi-legend-item"><span class="suivi-legend-dash"></span>Objectif</span>`;
  } else {
    el.innerHTML=`<span class="suivi-legend-item"><span class="suivi-legend-swatch" style="background:#1D9E75"></span>Protéines</span>
      <span class="suivi-legend-item"><span class="suivi-legend-swatch" style="background:#C9622E"></span>Glucides</span>
      <span class="suivi-legend-item"><span class="suivi-legend-swatch" style="background:#6B5FBE"></span>Lipides</span>`;
  }
}

function renderSuivi(){
  if(typeof Chart==="undefined") return; // Chart.js pas encore chargé (ou hors-ligne)

  const tdee=computeTDEE();
  const dates=getPeriodDates(suiviPeriod);
  const isoList=dates.map(isoDate);
  const kcalValues=isoList.map(iso=>suiviLog[iso] ? suiviLog[iso].kcal : null);
  const trackedCount=kcalValues.filter(v=>v!=null).length;
  const trackedAvg=trackedCount>0 ? Math.round(kcalValues.filter(v=>v!=null).reduce((a,b)=>a+b,0)/trackedCount) : null;

  document.getElementById("suivi-avg").textContent = trackedAvg!=null ? trackedAvg+" kcal" : "—";
  document.getElementById("suivi-target").textContent = tdee ? tdee+" kcal" : "profil incomplet";
  document.getElementById("suivi-tracked").textContent = trackedCount+"/"+isoList.length;
  const deltaEl=document.getElementById("suivi-delta");
  if(trackedAvg!=null && tdee){
    const delta=trackedAvg-tdee;
    deltaEl.textContent=(delta>0?"+":"")+delta+" kcal";
    deltaEl.style.color = Math.abs(delta)<=100 ? "var(--accent)" : "var(--cat-plaisir)";
  } else {
    deltaEl.textContent="—";
    deltaEl.style.color="";
  }

  renderSuiviLegend();

  const labels = suiviPeriod==="7j"
    ? dates.map(d=>DAY_LABELS_SHORT[(d.getDay()+6)%7])
    : dates.map(d=>d.getDate()+"/"+(d.getMonth()+1));

  if(suiviMainChart) suiviMainChart.destroy();
  const ctx=document.getElementById("suivi-main-chart");
  if(!ctx) return;

  if(suiviView==="kcal"){
    suiviMainChart=new Chart(ctx,{
      data:{ labels, datasets:[
        { type:"bar", data:kcalValues, backgroundColor:"#1D9E75", borderRadius:4, maxBarThickness:24 },
        tdee ? { type:"line", data:isoList.map(()=>tdee), borderColor:"#8A8A82", borderDash:[5,4], borderWidth:1.5, pointRadius:0 } : null
      ].filter(Boolean) },
      options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
        scales:{ y:{ beginAtZero:true, ticks:{font:{size:10}} }, x:{ ticks:{font:{size:10}, maxRotation:0, autoSkip:true} } } }
    });
  } else {
    suiviMainChart=new Chart(ctx,{
      type:"bar",
      data:{ labels, datasets:[
        { label:"Protéines", data:isoList.map(iso=>suiviLog[iso]?suiviLog[iso].proteines:null), backgroundColor:"#1D9E75", stack:"s" },
        { label:"Glucides",  data:isoList.map(iso=>suiviLog[iso]?suiviLog[iso].glucides:null),  backgroundColor:"#C9622E", stack:"s" },
        { label:"Lipides",   data:isoList.map(iso=>suiviLog[iso]?suiviLog[iso].lipides:null),   backgroundColor:"#6B5FBE", stack:"s" }
      ]},
      options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
        scales:{ y:{ stacked:true, beginAtZero:true, ticks:{font:{size:10}} }, x:{ stacked:true, ticks:{font:{size:10}, maxRotation:0, autoSkip:true} } } }
    });
  }

  // Poids : on affiche les semaines renseignées, triées chronologiquement
  const weightEntries=Object.entries(weightLog).sort((a,b)=>a[0]<b[0]?-1:1);
  const trendEl=document.getElementById("suivi-weight-trend");
  if(weightEntries.length>=2){
    const diff=Math.round((weightEntries[weightEntries.length-1][1]-weightEntries[0][1])*10)/10;
    trendEl.textContent=(diff>0?"+":"")+diff+" kg depuis "+weightEntries.length+" semaines";
    trendEl.style.color = diff<=0 ? "var(--accent)" : "var(--cat-plaisir)";
  } else {
    trendEl.textContent = weightEntries.length===1 ? "Première pesée enregistrée" : "Pas encore de pesée";
    trendEl.style.color="var(--ink-faint)";
  }
  if(suiviWeightChart) suiviWeightChart.destroy();
  const wctx=document.getElementById("suivi-weight-chart");
  if(wctx){
    suiviWeightChart=new Chart(wctx,{
      type:"line",
      data:{ labels:weightEntries.map(([k])=>{ const d=new Date(k); return d.getDate()+"/"+(d.getMonth()+1); }),
             datasets:[{ data:weightEntries.map(([,v])=>v), borderColor:"#6B5FBE", backgroundColor:"#6B5FBE", borderWidth:2, pointRadius:3, tension:0.3 }] },
      options:{ responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}},
        scales:{ y:{ ticks:{font:{size:10}, callback:v=>v+"kg"} }, x:{ ticks:{font:{size:10}} } } }
    });
  }

  // Journal : les jours de la semaine calendaire en cours, du lundi à aujourd'hui, le plus récent en premier
  const journalRoot=document.getElementById("suivi-journal");
  const today=new Date(); today.setHours(0,0,0,0);
  const monday=mondayOf(today);
  const journalDays=[];
  for(let i=0;i<7;i++){
    const d=new Date(monday); d.setDate(d.getDate()+i);
    if(d>today) break;
    journalDays.push({date:d, dayIdx:i});
  }
  journalDays.reverse();
  journalRoot.innerHTML=journalDays.map(({date,dayIdx})=>{
    const iso=isoDate(date);
    const checked=!!suiviLog[iso];
    const label = iso===isoDate(today) ? "Aujourd'hui" : date.toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"short"});
    const kcalLabel = checked ? suiviLog[iso].kcal+" kcal" : "";
    return `<label class="suivi-journal-row">
      <input type="checkbox" class="suivi-journal-cb" data-iso="${iso}" data-dayidx="${dayIdx}" ${checked?"checked":""}>
      <span class="suivi-journal-date">${label}</span>
      <span class="suivi-journal-kcal">${kcalLabel}</span>
    </label>`;
  }).join("") || `<p class="suivi-empty">Reviens ici une fois que tu auras planifié ta semaine.</p>`;

  journalRoot.querySelectorAll(".suivi-journal-cb").forEach(cb=>{
    cb.addEventListener("change",()=>toggleSuiviDay(cb.dataset.iso, parseInt(cb.dataset.dayidx), cb.checked));
  });
}

function initSuivi(){
  document.querySelectorAll(".suivi-chip").forEach(btn=>{
    btn.addEventListener("click",()=>{
      document.querySelectorAll(".suivi-chip").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      suiviPeriod=btn.dataset.period;
      renderSuivi();
    });
  });
  document.querySelectorAll(".suivi-view-chip").forEach(btn=>{
    btn.addEventListener("click",()=>{
      document.querySelectorAll(".suivi-view-chip").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      suiviView=btn.dataset.view;
      renderSuivi();
    });
  });
  document.getElementById("suivi-weight-save").addEventListener("click", saveWeightEntry);
  document.getElementById("suivi-weight-input").addEventListener("keydown",e=>{ if(e.key==="Enter") saveWeightEntry(); });
}

function renderSummary(){
  const filled=week.filter(Boolean).length;
  document.getElementById("count-out").textContent=filled+" / 14";
  document.getElementById("cost-out").textContent=fmt.format(shoppingCostToBuy());
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

const ALL_VIEWS = ["choisir","semaine","courses","frigo","petitsdej","suivi","profil","sources"];

function initTabs(){
  document.querySelectorAll(".tab-btn").forEach(btn=>{
    btn.addEventListener("click",()=>{
      document.querySelectorAll(".tab-btn").forEach(b=>{b.classList.remove("active");b.setAttribute("aria-selected","false");});
      btn.classList.add("active"); btn.setAttribute("aria-selected","true");
      ALL_VIEWS.forEach(name=>document.getElementById("view-"+name).classList.toggle("hidden",btn.dataset.view!==name));
      if(btn.dataset.view==="suivi") renderSuivi();
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
  initSuivi();

  loadProfile();
  loadFridge();
  loadBreakfasts();
  loadSuivi();
  loadWeightLog();

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

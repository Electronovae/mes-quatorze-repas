// ─── Constantes ──────────────────────────────────────────────────────────────

const DAYS        = ["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
const STORAGE_KEY = "mes-14-repas-semaine-v2";
const FRIDGE_KEY  = "mes-14-repas-frigo-v2";      // [{name, qty, unit}]
const PROFILE_KEY = "mes-14-repas-profil";         // {pathologies:[], personnes:2}
const BREAKFASTS_KEY = "mes-14-repas-petitsdej";   // Set d'ids sélectionnés

const fmt    = new Intl.NumberFormat("fr-FR", {style:"currency", currency:"EUR"});
const qtyFmt = n => { const r = Math.round(n*10)/10; return (r%1===0 ? r : r.toString().replace(".",",")).toString(); };

// ─── État global ─────────────────────────────────────────────────────────────

let CATS        = [];
let INGREDIENTS = {};       // {nom -> {kcal, glucides, proteines, lipides, fibres, per}}
let week        = new Array(14).fill(null);
let fridgeItems = [];       // [{name, qty, unit}]
let profile     = {pathologies:[], personnes:2};
let selectedBreakfasts = new Set(); // ids des petits-dej cochés
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
  try { const r=JSON.parse(localStorage.getItem(PROFILE_KEY)||"null"); if(r) profile=Object.assign({pathologies:[],personnes:2},r); } catch(e){}
}
function saveProfile(){ try{localStorage.setItem(PROFILE_KEY,JSON.stringify(profile));}catch(e){} }

function loadBreakfasts(){
  try { const r=JSON.parse(localStorage.getItem(BREAKFASTS_KEY)||"[]"); selectedBreakfasts=new Set(r); } catch(e){ selectedBreakfasts=new Set(); }
}
function saveBreakfasts(){ try{localStorage.setItem(BREAKFASTS_KEY,JSON.stringify([...selectedBreakfasts]));}catch(e){} }

// ─── Frigo helpers ───────────────────────────────────────────────────────────

function normName(n){ return n.trim().toLowerCase(); }
function fridgeEntry(name){ return fridgeItems.find(f=>normName(f.name)===normName(name)); }

function setFridgeQty(name,qty,unit){
  const idx = fridgeItems.findIndex(f=>normName(f.name)===normName(name));
  if(qty<=0){ if(idx!==-1){fridgeItems.splice(idx,1);} }
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
    kcal:      Math.round(data.kcal      * factor),
    glucides:  Math.round(data.glucides  * factor * 10)/10,
    proteines: Math.round(data.proteines * factor * 10)/10,
    lipides:   Math.round(data.lipides   * factor * 10)/10,
    fibres:    Math.round(data.fibres    * factor * 10)/10,
  };
}
function nutriForMeal(meal,portions){
  const totals = {kcal:0,glucides:0,proteines:0,lipides:0,fibres:0};
  meal.ingredients.forEach(ing=>{
    const n=nutriForIngredient({...ing,qty:ing.qty*portions});
    totals.kcal+=n.kcal; totals.glucides+=n.glucides; totals.proteines+=n.proteines; totals.lipides+=n.lipides; totals.fibres+=n.fibres;
  });
  return totals;
}

// ─── Semaine helpers ─────────────────────────────────────────────────────────

function getCat(id){ return CATS.find(c=>c.id===id); }
function countInCat(id){ return week.filter(s=>s&&s.catId===id).length; }
function shuffle(arr){ for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];} return arr; }

function addToWeek(catId,mealIdx){
  const cat=getCat(catId); if(countInCat(catId)>=cat.quota) return;
  const empty=week.findIndex(s=>s===null); if(empty===-1) return;
  week[empty]={catId,mealIdx,portions:profile.personnes};
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
  week[slotIdx]={catId:slot.catId,mealIdx:cands[Math.floor(Math.random()*cands.length)],portions:slot.portions};
  saveWeek(); renderAll();
}
function setPortions(slotIdx,delta){
  const slot=week[slotIdx]; if(!slot) return;
  slot.portions=Math.min(8,Math.max(1,(slot.portions||1)+delta));
  saveWeek(); renderAll();
}
function drawWeek(){
  const mainCats = CATS.filter(c=>c.id!=="petits-dejeuners");
  let picks=[]; mainCats.forEach(cat=>{ shuffle(cat.meals.map((_,i)=>i)).slice(0,cat.quota).forEach(idx=>picks.push({catId:cat.id,mealIdx:idx,portions:profile.personnes})); });
  week=shuffle(picks); expandedSlots.clear(); saveWeek(); renderAll();
}
function clearWeek(){ week=new Array(14).fill(null); expandedSlots.clear(); saveWeek(); renderAll(); }

// ─── Rendu : catégories ───────────────────────────────────────────────────────

function renderCategories(){
  const root=document.getElementById("categories");
  const openIds=Array.from(root.querySelectorAll(".cat.open")).map(el=>el.dataset.catId);
  const mainCats=CATS.filter(c=>c.id!=="petits-dejeuners");
  root.innerHTML=mainCats.map(cat=>{
    const used=countInCat(cat.id);
    const isOpen=openIds.includes(cat.id);
    const cards=cat.meals.map((m,idx)=>{
      const disabled=used>=cat.quota;
      const matchesProfil = profile.pathologies.length===0 || (m.pathologies||[]).some(p=>profile.pathologies.includes(p));
      const badgeHtml = matchesProfil && profile.pathologies.length>0 ? `<span class="match-badge">✓ ton profil</span>` : "";
      return `<div class="meal-card ${matchesProfil&&profile.pathologies.length>0?"meal-match":""}">
        ${badgeHtml}
        <p class="name">${m.name}</p>
        <p class="portion">${m.ingredients.map(i=>qtyFmt(i.qty)+" "+i.unit+" "+i.name).join(", ")}</p>
        <p class="benefit">${m.benefit}</p>
        <div class="row">
          <span class="price">${fmt.format(m.pricePerPortion)}</span>
          <button class="btn add-btn" data-cat="${cat.id}" data-idx="${idx}" ${disabled?"disabled":""}>${disabled?"Quota atteint":"Ajouter"}</button>
        </div>
      </div>`;
    }).join("");
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
          <button data-slot="${i}" data-delta="-1" class="portion-btn" aria-label="Réduire">−</button>
          <span class="count">${portions} portion${portions>1?"s":""}</span>
          <button data-slot="${i}" data-delta="1" class="portion-btn" aria-label="Augmenter">+</button>
        </div>
        <span class="slot-actions">
          <button data-slot="${i}" class="slot-reroll" aria-label="Changer">↻</button>
          <button data-slot="${i}" class="slot-remove" aria-label="Retirer">×</button>
          <button data-slot="${i}" class="slot-toggle" aria-label="Recette"><span class="chevron">⌄</span></button>
        </span>
      </div>
      <div class="slot-detail">
        <div class="nutri-strip">
          <span>${nutri.kcal} kcal</span><span>${nutri.proteines}g prot.</span><span>${nutri.glucides}g glu.</span><span>${nutri.lipides}g lip.</span><span>${nutri.fibres}g fib.</span>
        </div>
        <p class="detail-label">Ingrédients pour ${portions} portion${portions>1?"s":""}</p>
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
          <span>${nutri.kcal} kcal</span><span>${nutri.proteines}g prot.</span><span>${nutri.glucides}g glu.</span><span>${nutri.lipides}g lip.</span><span>${nutri.fibres}g fib.</span>
        </div>
      </div>`;
    }).join("");
  }

  listRoot.innerHTML=html;
  listRoot.querySelectorAll(".slot-remove").forEach(btn=>btn.addEventListener("click",()=>removeFromWeek(parseInt(btn.dataset.slot))));
  listRoot.querySelectorAll(".slot-reroll").forEach(btn=>btn.addEventListener("click",()=>rerollSlot(parseInt(btn.dataset.slot))));
  listRoot.querySelectorAll(".portion-btn").forEach(btn=>btn.addEventListener("click",()=>setPortions(parseInt(btn.dataset.slot),parseInt(btn.dataset.delta))));
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
  // Petits déjeuners
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
    const realName=findRealName(name)||name;
    return {name:realName,unit,qty};
  }).sort((a,b)=>a.name.localeCompare(b.name,"fr"));
}

function findRealName(normalized){
  // retrouve le vrai casse depuis CATS
  for(const cat of CATS) for(const m of cat.meals) for(const ing of m.ingredients)
    if(normName(ing.name)===normalized) return ing.name;
  return null;
}

function fridgeStatus(ing){
  const f=fridgeEntry(ing.name);
  if(!f) return {status:"none",toBuy:ing.qty};
  if(f.unit!==ing.unit) return {status:"none",toBy:ing.qty}; // unité incompatible → acheter tout
  if(f.qty>=ing.qty) return {status:"full",toBy:0};
  return {status:"partial",toBy:ing.qty-f.qty,inStock:f.qty};
}

function renderShoppingList(){
  const root=document.getElementById("shopping-list");
  const items=computeShoppingList();
  if(items.length===0){
    root.innerHTML=`<div class="empty-state">Pas encore de repas dans ta semaine.</div>`; return;
  }

  const toBuy    = items.filter(i=>fridgeStatus(i).status!=="full");
  const inStock  = items.filter(i=>fridgeStatus(i).status==="full");

  // Complétion globale
  const pct = items.length>0 ? Math.round(inStock.length/items.length*100) : 0;

  let html=`<div class="completion-bar-wrap">
    <div class="completion-bar-track"><div class="completion-bar-fill" style="width:${pct}%"></div></div>
    <span class="completion-label">${pct}% déjà en stock (${inStock.length}/${items.length})</span>
  </div>`;

  if(toBuy.length===0){
    html+=`<li class="shopping-all-stock">Tout est déjà dans ton frigo ! 🎉</li>`;
  } else {
    html+=toBuy.map((item,i)=>{
      const {status,toBy,inStock:stockQty}=fridgeStatus(item);
      const qtyLabel=status==="partial"
        ? `<span class="ing-qty partial">${qtyFmt(toBy)} ${item.unit} <span class="in-stock-hint">(${qtyFmt(stockQty)} en stock)</span></span>`
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
    const {status,toBy}=fridgeStatus(item);
    const q=status==="partial"?toBy:item.qty;
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
    footerEl.innerHTML=`<p class="frigo-empty">Ton frigo est vide. Ajoute ce que tu as déjà chez toi pour que ça se déduise de ta liste de courses.</p>`;
    return;
  }
  const sorted=[...fridgeItems].sort((a,b)=>a.name.localeCompare(b.name,"fr"));
  listEl.innerHTML=sorted.map(f=>{
    const safe=f.name.replace(/"/g,"&quot;");
    return `<li class="frigo-item">
      <span class="frigo-name">${f.name}</span>
      <div class="frigo-qty-row">
        <button class="frigo-qty-btn" data-name="${safe}" data-delta="-10" data-unit="${f.unit}">−</button>
        <span class="frigo-qty-val">${qtyFmt(f.qty)} ${f.unit}</span>
        <button class="frigo-qty-btn" data-name="${safe}" data-delta="10" data-unit="${f.unit}">+</button>
      </div>
      <button class="frigo-remove" data-name="${safe}" aria-label="Retirer">×</button>
    </li>`;
  }).join("");
  footerEl.innerHTML=`<button class="btn frigo-clear-btn" id="frigo-clear-btn">Vider le frigo</button>`;

  listEl.querySelectorAll(".frigo-qty-btn").forEach(btn=>btn.addEventListener("click",()=>{
    const f=fridgeItems.find(x=>normName(x.name)===normName(btn.dataset.name));
    if(f){ setFridgeQty(f.name,Math.max(0,f.qty+parseFloat(btn.dataset.delta)),f.unit); renderFridge(); renderShoppingList(); }
  }));
  listEl.querySelectorAll(".frigo-remove").forEach(btn=>btn.addEventListener("click",()=>{
    removeFridgeItem(btn.dataset.name); renderFridge(); renderShoppingList();
  }));
  document.getElementById("frigo-clear-btn").addEventListener("click",()=>{
    if(confirm("Vider tout le frigo ?")){ fridgeItems=[]; saveFridge(); renderFridge(); renderShoppingList(); }
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
  renderFridge(); renderShoppingList();
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
          <span class="pj-nutri">${nutri.kcal} kcal · ${nutri.proteines}g P · ${nutri.glucides}g G</span>
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

const PATHOLOGIES_DEF = [
  {id:"hypertriglyceridemie", label:"Hypertriglycéridémie"},
  {id:"steatose-hepatique",   label:"Stéatose hépatique (NAFLD)"},
  {id:"diabete-type-2",       label:"Diabète type 2"},
  {id:"hta",                  label:"Hypertension artérielle"},
  {id:"obesite",              label:"Obésité / perte de poids"},
  {id:"hypercholesterolemie", label:"Hypercholestérolémie"},
];

function renderProfile(){
  const root=document.getElementById("profile-content");
  if(!root) return;
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
  `;
  document.getElementById("pers-minus").addEventListener("click",()=>{ profile.personnes=Math.max(1,profile.personnes-1); saveProfile(); renderProfile(); });
  document.getElementById("pers-plus").addEventListener("click",()=>{ profile.personnes=Math.min(12,profile.personnes+1); saveProfile(); renderProfile(); });
  root.querySelectorAll(".patho-cb").forEach(cb=>cb.addEventListener("change",()=>{
    if(cb.checked) { if(!profile.pathologies.includes(cb.dataset.id)) profile.pathologies.push(cb.dataset.id); }
    else { profile.pathologies=profile.pathologies.filter(p=>p!==cb.dataset.id); }
    saveProfile();
    cb.closest("label").classList.toggle("patho-active",cb.checked);
    renderCategories(); renderBreakfasts();
  }));
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
  renderWeek();
  renderShoppingList();
  renderSummary();
  renderFridge();
  renderBreakfasts();
  renderProfile();
}

// ─── Onglets ──────────────────────────────────────────────────────────────────

const ALL_VIEWS = ["choisir","semaine","courses","frigo","petitsdej","profil"];

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
  document.getElementById("draw-btn").addEventListener("click", drawWeek);
  document.getElementById("clear-btn").addEventListener("click", clearWeek);
  document.getElementById("copy-list-btn").addEventListener("click", copyShoppingList);
  document.getElementById("frigo-add-btn").addEventListener("click", handleFrigoAdd);
  document.getElementById("frigo-input").addEventListener("keydown",e=>{ if(e.key==="Enter") handleFrigoAdd(); });
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

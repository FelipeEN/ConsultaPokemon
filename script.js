(() => {
  "use strict";

  const BASE = "https://pokeapi.co/api/v2";
  const PAGE_SIZE = 20;
  const TTL = 24 * 60 * 60 * 1000;
  const memory = new Map();

  const $ = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
  const normalize = value => String(value ?? "").trim().toLowerCase();
  const meters = value => (Number(value) / 10).toFixed(1);
  const kilograms = value => (Number(value) / 10).toFixed(1);
  const pageCount = (total, size) => Math.max(1, Math.ceil(total / size));
  const addFavorite = (items, id) => [...new Set([...items, id])];
  const removeFavorite = (items, id) => items.filter(item => item !== id);
  const idFromUrl = url => Number(String(url).match(/\/(\d+)\/?$/)?.[1]);
  const image = p => p.sprites?.other?.["official-artwork"]?.front_default || p.sprites?.front_default || "";

  const typeNames = {
    normal:"Normal",fire:"Fogo",water:"Água",electric:"Elétrico",grass:"Planta",
    ice:"Gelo",fighting:"Lutador",poison:"Veneno",ground:"Terra",flying:"Voador",
    psychic:"Psíquico",bug:"Inseto",rock:"Pedra",ghost:"Fantasma",dragon:"Dragão",
    dark:"Sombrio",steel:"Aço",fairy:"Fada"
  };
  const statNames = {
    hp:"HP",attack:"Ataque",defense:"Defesa","special-attack":"Ataque especial",
    "special-defense":"Defesa especial",speed:"Velocidade"
  };
  const safeImage = url => typeof url === "string" && url.startsWith("https://") ? url : "";
  const picture = (url, name, cls="") => safeImage(url)
    ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" loading="lazy" class="${cls}">`
    : `<div class="${cls} flex items-center justify-center text-sm text-[#53677b]" role="img" aria-label="Imagem indisponível">Sem imagem</div>`;

  // Gateway: centraliza todas as requisições à PokéAPI e aplica cache de 24 horas.
  const gateway = {
    async get(path) {
      const key = BASE + path;
      const cached = memory.get(key);
      if (cached && cached.expires > Date.now()) return cached.data;

      try {
        const stored = JSON.parse(localStorage.getItem("pokedex-cache:" + key) || "null");
        if (stored?.expires > Date.now()) {
          memory.set(key, stored);
          return stored.data;
        }
      } catch (_) {}

      let response;
      try { response = await fetch(key); }
      catch (_) { throw new Error("network"); }

      if (response.status === 404) throw new Error("not-found");
      if (!response.ok) throw new Error("network");

      let data;
      try { data = await response.json(); }
      catch (_) { throw new Error("invalid"); }

      if (!data || typeof data !== "object") throw new Error("invalid");

      const entry = {data, expires:Date.now() + TTL};
      memory.set(key, entry);
      try { localStorage.setItem("pokedex-cache:" + key, JSON.stringify(entry)); }
      catch (_) {}
      return data;
    },
    pokemon: value => gateway.get("/pokemon/" + encodeURIComponent(normalize(value))),
    list: (limit, offset) => gateway.get(`/pokemon?limit=${limit}&offset=${offset}`),
    types: () => gateway.get("/type"),
    type: name => gateway.get("/type/" + encodeURIComponent(name)),
    species: id => gateway.get("/pokemon-species/" + id),
    evolution: id => gateway.get("/evolution-chain/" + id)
  };

  // Serviço de favoritos: guarda apenas os IDs no armazenamento local.
  const favoriteService = {
    read() {
      try {
        const ids = JSON.parse(localStorage.getItem("pokedex-favorites-v1") || "[]");
        return Array.isArray(ids) ? ids.filter(Number.isInteger) : [];
      } catch (_) { return []; }
    },
    has(id) { return this.read().includes(id); },
    toggle(id) {
      const ids = this.read();
      const next = ids.includes(id) ? removeFavorite(ids, id) : addFavorite(ids, id);
      try { localStorage.setItem("pokedex-favorites-v1", JSON.stringify(next)); }
      catch (_) { throw new Error("storage"); }
      return next.includes(id);
    }
  };

  // Estado da aplicação.
  let catalog = [];
  let filtered = [];
  let selectedType = "";
  let selectedTypeIds = null;
  let listQuery = "";
  let page = 1;
  let listToken = 0;
  let detailToken = 0;
  let favoritesToken = 0;
  let compared = [];

  function message(error) {
    if (error?.message === "not-found") return "Pokémon não encontrado. Confira o nome ou número e tente novamente.";
    if (error?.message === "invalid") return "A API retornou uma resposta inválida. Tente novamente mais tarde.";
    if (error?.message === "storage") return "Não foi possível salvar os favoritos neste navegador.";
    return "Não foi possível conectar à PokéAPI. Confira sua conexão e tente novamente.";
  }

  function toast(text) {
    const el = $("toast");
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.hidden = true, 4200);
  }

  function status(id, text, loading=false) {
    $(id).textContent = text;
    $(id).classList.toggle("loading", loading);
  }

  function validPokemon(p) {
    return p && Number.isInteger(p.id) && typeof p.name === "string"
      && Array.isArray(p.stats) && Array.isArray(p.types);
  }

  function typeBadges(p) {
    return p.types.map(t =>
      `<span class="badge" data-type="${escapeHtml(t.type.name)}">${escapeHtml(typeNames[t.type.name] || t.type.name)}</span>`
    ).join(" ");
  }

  function stats(p) {
    return p.stats.map(s => {
      const value = Number(s.base_stat) || 0;
      const label = statNames[s.stat.name] || s.stat.name;
      return `<div class="grid grid-cols-[105px_1fr_36px] items-center gap-2 text-xs mb-3">
        <span>${escapeHtml(label)}</span>
        <div class="stat-track" role="meter" aria-label="${escapeHtml(label)}" aria-valuenow="${value}" aria-valuemin="0" aria-valuemax="255">
          <div class="stat-fill" style="width:${Math.min(100,value/255*100)}%"></div>
        </div>
        <strong class="text-right mono">${value}</strong>
      </div>`;
    }).join("");
  }

  function card(p) {
    const active = favoriteService.has(p.id);
    const comparing = compared.some(x => x.id === p.id);
    return `<article class="card" data-pokemon-id="${p.id}">
      <div class="poke-img h-32 sm:h-40 flex items-center justify-center">${picture(image(p),p.name,"w-full h-full object-contain p-3")}</div>
      <div class="p-3">
        <p class="mono text-xs text-[#53677b]">#${String(p.id).padStart(4,"0")}</p>
        <h3 class="font-extrabold capitalize text-lg truncate">${escapeHtml(p.name)}</h3>
        <div class="flex flex-wrap gap-1 my-2">${typeBadges(p)}</div>
        <div class="flex flex-wrap gap-2 mt-3">
          <button type="button" class="secondary !p-2 !text-xs" data-action="open" data-id="${p.id}" aria-label="Ver detalhes de ${escapeHtml(p.name)}">Detalhes</button>
          <button type="button" class="secondary !p-2 !text-xs" data-action="favorite" data-id="${p.id}" aria-pressed="${active}" aria-label="${active ? "Remover dos favoritos" : "Adicionar aos favoritos"}: ${escapeHtml(p.name)}">${active ? "♥ Salvo" : "♡ Favorito"}</button>
          <button type="button" class="secondary !p-2 !text-xs" data-action="compare" data-id="${p.id}" aria-pressed="${comparing}">${comparing ? "✓ Comparando" : "Comparar"}</button>
        </div>
      </div>
    </article>`;
  }

  function refreshButtons() {
    document.querySelectorAll('[data-action="favorite"]').forEach(b => {
      const active = favoriteService.has(Number(b.dataset.id));
      b.textContent = active ? "♥ Salvo" : "♡ Favorito";
      b.setAttribute("aria-pressed",String(active));
      b.setAttribute("aria-label",`${active ? "Remover dos favoritos" : "Adicionar aos favoritos"}: ${b.closest("[data-pokemon-id]")?.querySelector("h2,h3")?.textContent || "Pokémon"}`);
    });
    document.querySelectorAll('[data-action="compare"]').forEach(b => {
      const active = compared.some(p => p.id === Number(b.dataset.id));
      b.textContent = active ? "✓ Comparando" : "Comparar";
      b.setAttribute("aria-pressed",String(active));
    });
  }

  function switchView(view) {
    document.querySelectorAll(".view").forEach(v => v.hidden = v.id !== view + "-view");
    document.querySelectorAll(".navbtn").forEach(b => {
      b.classList.toggle("active",b.dataset.view === view);
      if (b.dataset.view === view) b.setAttribute("aria-current","page");
      else b.removeAttribute("aria-current");
    });
    if (view === "favorites") renderFavorites();
    if (view === "compare") renderCompare();
  }

  function applyFilters() {
    const q = normalize(listQuery);
    filtered = catalog.filter(p =>
      (!selectedType || selectedTypeIds?.has(p.id)) &&
      (!q || p.name.includes(q) || String(p.id).includes(q))
    );
    page = 1;
    renderList();
  }

  async function renderList() {
    const token = ++listToken;
    const total = filtered.length;
    const pages = pageCount(total,PAGE_SIZE);
    page = Math.min(Math.max(1,page),pages);
    $("prev-btn").disabled = page <= 1;
    $("next-btn").disabled = page >= pages;
    $("page-info").textContent = `Página ${page} de ${pages} · ${total} resultados`;

    if (!total) {
      $("catalog").innerHTML = "";
      status("list-status","Nenhum Pokémon corresponde aos filtros.");
      return;
    }

    $("catalog").innerHTML = "";
    status("list-status","Carregando Pokémon...",true);
    const slice = filtered.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
    const results = await Promise.allSettled(slice.map(x => gateway.pokemon(x.id)));
    if (token !== listToken) return;

    const good = results
      .filter(r => r.status === "fulfilled" && validPokemon(r.value))
      .map(r => r.value);
    $("catalog").innerHTML = good.map(card).join("");
    status("list-status",good.length === 0
      ? "Não foi possível carregar esta página. Use os controles para tentar novamente."
      : good.length < slice.length ? "Alguns Pokémon não puderam ser carregados." : "");
  }

  async function loadCatalog() {
    status("list-status","Carregando catálogo...",true);
    try {
      const first = await gateway.list(1,0);
      if (!Number.isInteger(first.count) || !Array.isArray(first.results)) throw new Error("invalid");
      const all = await gateway.list(first.count,0);
      if (!Array.isArray(all.results)) throw new Error("invalid");

      catalog = all.results
        .map(x => ({id:idFromUrl(x.url),name:normalize(x.name)}))
        .filter(x => Number.isInteger(x.id) && x.name);
      filtered = catalog.slice();
      renderList();
    } catch(e) {
      status("list-status",message(e) + " Atualize a página para tentar novamente.");
    }

    try {
      const result = await gateway.types();
      if (!Array.isArray(result.results)) return;
      result.results.filter(t => typeNames[t.name]).forEach(t => {
        const option = document.createElement("option");
        option.value = t.name;
        option.textContent = typeNames[t.name];
        $("type-filter").append(option);
      });
    } catch(_) { toast("Não foi possível carregar os filtros por tipo."); }
  }

  async function showPokemon(value) {
    switchView("search");
    const token = ++detailToken;
    $("detail").innerHTML = "";
    status("detail-status","Consultando Pokémon...",true);

    try {
      const p = await gateway.pokemon(value);
      if (!validPokemon(p)) throw new Error("invalid");
      if (token !== detailToken) return;
      status("detail-status","");

      const sprites = [
        ["Sprite frontal",p.sprites?.front_default],
        ["Sprite traseiro",p.sprites?.back_default],
        ["Versão brilhante",p.sprites?.front_shiny],
        ["Brilhante traseiro",p.sprites?.back_shiny]
      ].filter(x => safeImage(x[1]));

      $("detail").innerHTML = `<article class="panel p-5 md:p-8" data-pokemon-id="${p.id}">
        <div class="detail-grid grid grid-cols-[minmax(220px,38%)_1fr] gap-7">
          <div>
            <div class="poke-img rounded-2xl h-64 md:h-80">${picture(image(p),p.name,"w-full h-full object-contain p-5")}</div>
            ${sprites.length ? `<div class="flex flex-wrap gap-2 mt-3">${sprites.map(([label,url]) => `
              <div class="text-center">
                <div class="w-16 h-16 rounded-xl bg-[#dcebe6]">${picture(url,`${label} de ${p.name}`,"w-full h-full object-contain")}</div>
                <span class="text-[10px]">${escapeHtml(label)}</span>
              </div>`).join("")}</div>` : ""}
          </div>
          <div>
            <p class="mono text-sm text-[#a34248] font-bold">Nº ${String(p.id).padStart(4,"0")}</p>
            <h2 class="font-extrabold capitalize text-4xl mt-2 mb-3">${escapeHtml(p.name)}</h2>
            <div class="flex gap-2 mb-5">${typeBadges(p)}</div>
            <div class="flex flex-wrap gap-2 mb-6">
              <button type="button" class="secondary" data-action="favorite" data-id="${p.id}"></button>
              <button type="button" class="secondary" data-action="compare" data-id="${p.id}"></button>
            </div>
            <div class="grid grid-cols-2 gap-3 mb-6">
              <div class="bg-[#dcebe6] p-4 rounded-xl"><span class="block text-xs">Altura</span><strong>${meters(p.height)} m</strong></div>
              <div class="bg-[#dcebe6] p-4 rounded-xl"><span class="block text-xs">Peso</span><strong>${kilograms(p.weight)} kg</strong></div>
            </div>
            <h3 class="font-bold mb-2">Habilidades</h3>
            <p class="capitalize mb-5">${p.abilities?.map(a => escapeHtml(a.ability.name.replaceAll("-"," "))).join(" · ") || "Não informadas"}</p>
            <h3 class="font-bold mb-2">Estatísticas base</h3>${stats(p)}
          </div>
        </div>
        <div class="grid md:grid-cols-2 gap-6 mt-8 pt-6 border-t-2 border-[#b7cad0]">
          <div><h3 class="font-bold mb-3">Espécie</h3><div id="species-content" class="text-sm leading-relaxed" aria-live="polite">Carregando espécie...</div></div>
          <div><h3 class="font-bold mb-3">Movimentos principais</h3><p class="text-sm capitalize">${p.moves?.slice(0,8).map(m => escapeHtml(m.move.name.replaceAll("-"," "))).join(" · ") || "Não informados"}</p></div>
        </div>
        <div class="mt-7 pt-6 border-t-2 border-[#b7cad0]">
          <h3 class="font-bold mb-3">Evoluções</h3>
          <div id="evolution-content" class="flex flex-wrap gap-3" aria-live="polite">Carregando evoluções...</div>
        </div>
      </article>`;

      refreshButtons();
      loadSpecies(p.id,token);
    } catch(e) {
      if (token === detailToken) status("detail-status",message(e));
    }
  }

  async function loadSpecies(id,token) {
    try {
      const species = await gateway.species(id);
      if (token !== detailToken) return;

      const description = species.flavor_text_entries?.find(x => x.language?.name === "pt")?.flavor_text
        || species.flavor_text_entries?.find(x => x.language?.name === "en")?.flavor_text;
      const category = species.genera?.find(x => x.language?.name === "pt")?.genus
        || species.genera?.find(x => x.language?.name === "en")?.genus;

      $("species-content").innerHTML = `<p class="mb-3">${escapeHtml(description?.replace(/\s+/g," ") || "Descrição indisponível.")}</p>
        <div class="grid grid-cols-2 gap-2">
          <p><strong>Categoria:</strong> ${escapeHtml(category || "Não informada")}</p>
          <p><strong>Habitat:</strong> ${escapeHtml(species.habitat?.name || "Não informado")}</p>
          <p><strong>Taxa de captura:</strong> ${escapeHtml(species.capture_rate ?? "Não informada")}</p>
          <p><strong>Felicidade base:</strong> ${escapeHtml(species.base_happiness ?? "Não informada")}</p>
          <p><strong>Crescimento:</strong> ${escapeHtml(species.growth_rate?.name || "Não informado")}</p>
          <p><strong>Classificação:</strong> ${species.is_mythical ? "Mítico" : species.is_legendary ? "Lendário" : "Não lendário"}</p>
        </div>`;

      if (!species.evolution_chain?.url) {
        $("evolution-content").textContent = "Cadeia de evoluções indisponível.";
        return;
      }

      try {
        const chain = await gateway.evolution(idFromUrl(species.evolution_chain.url));
        if (token !== detailToken) return;
        const stages = [];

        function walk(node,condition) {
          if (!node?.species) return;
          stages.push({name:node.species.name,id:idFromUrl(node.species.url),condition});
          (node.evolves_to || []).forEach(next => {
            const d = next.evolution_details?.[0];
            const label = d?.min_level ? `Nível ${d.min_level}`
              : d?.item?.name ? `Item: ${d.item.name}`
              : d?.trigger?.name ? `Condição: ${d.trigger.name}`
              : "Condição não informada";
            walk(next,label);
          });
        }

        walk(chain.chain,"Forma inicial");
        const found = await Promise.allSettled(stages.map(s => gateway.pokemon(s.id)));
        if (token !== detailToken) return;

        $("evolution-content").innerHTML = stages.map((s,i) => `
          <div class="bg-[#dcebe6] border border-[#9cb8bb] rounded-xl p-3 text-center w-32">
            ${picture(found[i].status === "fulfilled" ? image(found[i].value) : "",s.name,"w-24 h-24 object-contain mx-auto")}
            <p class="font-bold capitalize">${escapeHtml(s.name)}</p>
            <p class="text-xs text-[#53677b]">${escapeHtml(s.condition)}</p>
          </div>`).join("") || "Nenhuma evolução encontrada.";
      } catch (_) {
        if (token === detailToken) $("evolution-content").textContent = "Não foi possível carregar as evoluções.";
      }
    } catch (_) {
      if (token === detailToken) {
        $("species-content").textContent = "Informações da espécie indisponíveis no momento.";
        $("evolution-content").textContent = "Evoluções indisponíveis no momento.";
      }
    }
  }

  async function renderFavorites() {
    const token = ++favoritesToken;
    const ids = favoriteService.read();
    $("favorites-list").innerHTML = "";

    if (!ids.length) {
      status("favorites-status","Nenhum favorito ainda. Adicione Pokémon pela Pesquisa.");
      return;
    }

    status("favorites-status","Carregando favoritos...",true);
    const results = await Promise.allSettled(ids.map(id => gateway.pokemon(id)));
    if (token !== favoritesToken) return;

    $("favorites-list").innerHTML = results
      .filter(x => x.status === "fulfilled" && validPokemon(x.value))
      .map(x => card(x.value)).join("");
    status("favorites-status",results.some(x => x.status === "rejected")
      ? "Alguns favoritos não puderam ser carregados." : "");
  }

  function renderCompare() {
    if (!compared.length) {
      $("compare-list").innerHTML = '<p class="panel p-6 col-span-full">Selecione até dois Pokémon usando o botão Comparar na Pesquisa ou nos Favoritos.</p>';
      return;
    }

    $("compare-list").innerHTML = compared.map(p => `
      <article class="panel p-5" data-pokemon-id="${p.id}">
        <div class="flex justify-between gap-2">
          <span class="mono text-xs">#${p.id}</span>
          <button type="button" class="secondary !p-2 !text-xs" data-action="remove-compare" data-id="${p.id}" aria-label="Remover ${escapeHtml(p.name)} da comparação">Remover</button>
        </div>
        ${picture(image(p),p.name,"poke-img w-full h-48 object-contain rounded-xl my-3")}
        <h3 class="capitalize text-2xl font-extrabold mb-2">${escapeHtml(p.name)}</h3>
        <div class="flex gap-2 mb-4">${typeBadges(p)}</div>
        <p class="mb-2"><strong>Altura:</strong> ${meters(p.height)} m · <strong>Peso:</strong> ${kilograms(p.weight)} kg</p>
        <p class="capitalize mb-5"><strong>Habilidades:</strong> ${p.abilities?.map(a => escapeHtml(a.ability.name.replaceAll("-"," "))).join(", ") || "Não informadas"}</p>
        <h4 class="font-bold mb-3">Estatísticas base</h4>${stats(p)}
      </article>`).join("");
  }

  function runTests() {
    const tests = [
      ["Altura: 17 decímetros = 1,7 m", () => meters(17) === "1.7"],
      ["Peso: 69 hectogramas = 6,9 kg", () => kilograms(69) === "6.9"],
      ["Normalização de nomes", () => normalize("  PIKACHU  ") === "pikachu"],
      ["Validação de resposta Pokémon", () => validPokemon({id:25,name:"pikachu",stats:[],types:[]}) && !validPokemon({name:"pikachu"})],
      ["Paginação de 41 itens em páginas de 20", () => pageCount(41,20) === 3 && pageCount(0,20) === 1],
      ["Favoritos: adicionar sem duplicar", () => JSON.stringify(addFavorite(addFavorite([1],25),25)) === "[1,25]"],
      ["Favoritos: remover", () => JSON.stringify(removeFavorite([1,25],1)) === "[25]"]
    ];

    $("test-results").innerHTML = tests.map(([label,fn]) => {
      let passed = false;
      try { passed = !!fn(); } catch (_) {}
      return `<p class="flex items-center gap-3">
        <strong class="${passed ? "text-[#247654]" : "text-[#c43d32]"}">${passed ? "APROVADO" : "REPROVADO"}</strong>
        <span>${escapeHtml(label)}</span>
      </p>`;
    }).join("");
  }

  // Eventos da interface.
  document.querySelectorAll(".navbtn").forEach(b =>
    b.addEventListener("click",() => switchView(b.dataset.view))
  );

  $("search-form").addEventListener("submit",e => {
    e.preventDefault();
    const q = normalize($("pokemon-query").value);
    if (!q) {
      status("detail-status","Digite um nome ou número da Pokédex.");
      return;
    }
    showPokemon(q);
  });

  $("random-btn").addEventListener("click",async e => {
    const button = e.currentTarget;
    button.disabled = true;
    try {
      const count = catalog.length || (await gateway.list(1,0)).count;
      if (!count) throw new Error("invalid");
      const id = catalog.length
        ? catalog[Math.floor(Math.random()*catalog.length)].id
        : Math.floor(Math.random()*count)+1;
      await showPokemon(id);
    } catch(err) { toast(message(err)); }
    finally { button.disabled = false; }
  });

  let debounce;
  $("list-query").addEventListener("input",e => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      listQuery = e.target.value;
      applyFilters();
    },220);
  });

  $("type-filter").addEventListener("change",async e => {
    selectedType = e.target.value;
    selectedTypeIds = null;

    if (selectedType) {
      const chosen = selectedType;
      status("list-status","Aplicando filtro...",true);
      try {
        const data = await gateway.type(chosen);
        if (chosen !== selectedType) return;
        if (!Array.isArray(data.pokemon)) throw new Error("invalid");
        selectedTypeIds = new Set(data.pokemon.map(x => idFromUrl(x.pokemon.url)));
      } catch(err) {
        selectedType = "";
        e.target.value = "";
        status("list-status",message(err));
        return;
      }
    }
    applyFilters();
  });

  $("prev-btn").addEventListener("click",() => {
    if (page > 1) { page--; renderList(); }
  });

  $("next-btn").addEventListener("click",() => {
    if (page < pageCount(filtered.length,PAGE_SIZE)) { page++; renderList(); }
  });

  document.addEventListener("click",async e => {
    const b = e.target.closest("[data-action]");
    if (!b) return;
    const id = Number(b.dataset.id);

    if (b.dataset.action === "open") {
      showPokemon(id);
      window.scrollTo({top:0,behavior:"smooth"});
    }

    if (b.dataset.action === "favorite") {
      try {
        const active = favoriteService.toggle(id);
        refreshButtons();
        toast(active ? "Adicionado aos favoritos." : "Removido dos favoritos.");
        if (!$("favorites-view").hidden) renderFavorites();
      } catch(err) { toast(message(err)); }
    }

    if (b.dataset.action === "remove-compare") {
      compared = compared.filter(p => p.id !== id);
      renderCompare();
      refreshButtons();
    }

    if (b.dataset.action === "compare") {
      const existing = compared.some(p => p.id === id);
      if (existing) {
        compared = compared.filter(p => p.id !== id);
        renderCompare();
        refreshButtons();
        return;
      }
      if (compared.length >= 2) {
        toast("Remova um Pokémon antes de adicionar outro à comparação.");
        return;
      }

      b.disabled = true;
      try {
        const p = await gateway.pokemon(id);
        if (!validPokemon(p)) throw new Error("invalid");
        compared.push(p);
        renderCompare();
        refreshButtons();
        toast("Pokémon adicionado à comparação.");
      } catch(err) { toast(message(err)); }
      finally { b.disabled = false; }
    }
  });

  $("run-tests").addEventListener("click",runTests);

  // Inicialização.
  runTests();
  renderCompare();
  loadCatalog();
})();

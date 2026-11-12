(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const base = "https://pokeapi.co/api/v2";
  const cache = new Map();

  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));

  const norm = s => String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

  const names = {
    normal: "Normal",
    fire: "Fogo",
    water: "Água",
    electric: "Elétrico",
    grass: "Planta",
    ice: "Gelo",
    fighting: "Lutador",
    poison: "Veneno",
    ground: "Terra",
    flying: "Voador",
    psychic: "Psíquico",
    bug: "Inseto",
    rock: "Pedra",
    ghost: "Fantasma",
    dragon: "Dragão",
    dark: "Sombrio",
    steel: "Aço",
    fairy: "Fada"
  };

  async function api(path) {
    if (cache.has(path)) return cache.get(path);
    let response;
    try {
      response = await fetch(base + path);
    } catch {
      throw Error("Sem conexão com a PokéAPI.");
    }
    if (response.status === 404) throw Error("Pokémon não encontrado.");
    if (!response.ok) throw Error("A PokéAPI está indisponível.");
    const result = await response.json();
    cache.set(path, result);
    return result;
  }

  const pokemon = q => api("/pokemon/" + encodeURIComponent(norm(q)));
  const sprite = p =>
    p.sprites?.versions?.["generation-v"]?.["black-white"]?.animated?.front_default ||
    p.sprites?.front_default ||
    p.sprites?.other?.["official-artwork"]?.front_default;
  const art = p => p.sprites?.other?.["official-artwork"]?.front_default || sprite(p);

  const img = (url, name, cls) =>
    url && url.startsWith("https://")
      ? `<img src="${esc(url)}" alt="${esc(name)}" loading="lazy" class="${cls}">`
      : `<div class="${cls}">Sprite indisponível</div>`;

  const badges = p =>
    (p.types || [])
      .map(t => `<span class="badge" data-type="${esc(t.type.name)}">${esc(names[t.type.name] || t.type.name)}</span>`)
      .join("");

  const stats = p =>
    (p.stats || [])
      .map(s => `<div class="flex justify-between border-b border-[#b7cad0] py-1 text-sm"><span>${esc(s.stat.name.replaceAll("-", " "))}</span><strong>${Number(s.base_stat) || 0}</strong></div>`)
      .join("");

  const message = (id, text) => {
    const el = $(id);
    if (el) el.textContent = text;
  };

  let entries = [];
  let filtered = [];
  let page = 1;
  let selectedType = "";
  let typeIds = null;
  let listVersion = 0;
  let detailVersion = 0;
  let compared = [];
  let chosen = [null, null, null, null];
  let battle = null;
  let battleTimer = 0;
  let suggestionTimer = 0;
  let suggestionVersion = 0;
  let suggestionIndex = -1;
  let worldSuggestionTimer = 0;
  let worldSuggestionVersion = 0;
  let worldSuggestionIndex = -1;

  function closeSuggestions() {
    const box = $("pokemon-suggestions");
    box.hidden = true;
    $("pokemon-query").setAttribute("aria-expanded", "false");
    $("pokemon-query").setAttribute("aria-activedescendant", "");
    suggestionIndex = -1;
  }

  function suggestionMatches(value) {
    const q = norm(value);
    if (!q) return [];
    return entries
      .filter(p => p.name.includes(q) || String(p.id) === q || String(p.id).startsWith(q))
      .slice(0, 8);
  }

  async function updateSuggestions() {
    const input = $("pokemon-query");
    const box = $("pokemon-suggestions");
    const version = ++suggestionVersion;
    clearTimeout(suggestionTimer);
    const value = input.value.trim();

    if (!value) {
      closeSuggestions();
      return;
    }

    box.hidden = false;
    input.setAttribute("aria-expanded", "true");
    box.innerHTML = '<div class="suggestion-state" role="status">Buscando sugestões...</div>';

    suggestionTimer = setTimeout(async () => {
      const matches = suggestionMatches(value);
      if (version !== suggestionVersion) return;

      if (!matches.length) {
        box.innerHTML = '<div class="suggestion-state" role="status">Nenhum Pokémon encontrado.</div>';
        return;
      }

      box.innerHTML = matches
        .map(
          (p, i) => `
          <button id="suggestion-${p.id}" class="suggestion" role="option" aria-selected="${i === 0}" data-suggestion-id="${p.id}" type="button">
            <span class="mono">#${p.id}</span>
            <span class="capitalize flex-1">${esc(p.name)}</span>
            <span class="suggestion-thumb" data-thumb-id="${p.id}" aria-hidden="true"></span>
          </button>`
        )
        .join("");

      suggestionIndex = 0;
      input.setAttribute("aria-activedescendant", `suggestion-${matches[0].id}`);

      await Promise.all(
        matches.map(async p => {
          try {
            const data = await pokemon(p.id);
            const url = sprite(data);
            if (version === suggestionVersion && url) {
              const holder = document.querySelector(`[data-thumb-id="${p.id}"]`);
              if (holder) holder.innerHTML = img(url, p.name, "w-10 h-10 object-contain sprite");
            }
          } catch {}
        })
      );
    }, 220);
  }

  function chooseSuggestion(id) {
    const match = entries.find(p => p.id === id);
    if (!match) return;
    $("pokemon-query").value = match.name;
    closeSuggestions();
    showPokemon(match.id);
  }

  function closeWorldSuggestions() {
    const box = $("world-suggestions");
    box.hidden = true;
    $("world-query").setAttribute("aria-expanded", "false");
    $("world-query").setAttribute("aria-activedescendant", "");
    worldSuggestionIndex = -1;
  }

  function worldSuggestionMatches(value) {
    const q = norm(value);
    if (!q) return [];
    return entries
      .filter(p => p.name.includes(q) || String(p.id) === q || String(p.id).startsWith(q))
      .slice(0, 8);
  }

  async function updateWorldSuggestions() {
    const input = $("world-query");
    const box = $("world-suggestions");
    const version = ++worldSuggestionVersion;
    clearTimeout(worldSuggestionTimer);
    const value = input.value.trim();

    if (!value) {
      closeWorldSuggestions();
      return;
    }

    box.hidden = false;
    input.setAttribute("aria-expanded", "true");
    box.innerHTML = '<div class="suggestion-state" role="status">Buscando sugestões...</div>';

    worldSuggestionTimer = setTimeout(async () => {
      const matches = worldSuggestionMatches(value);
      if (version !== worldSuggestionVersion) return;

      if (!matches.length) {
        box.innerHTML = '<div class="suggestion-state" role="status">Nenhum Pokémon encontrado.</div>';
        return;
      }

      box.innerHTML = matches
        .map(
          (p, i) => `
          <button id="world-suggestion-${p.id}" class="world-suggestion" role="option" aria-selected="${i === 0}" data-world-suggestion-id="${p.id}" type="button">
            <span class="mono">#${p.id}</span>
            <span class="capitalize flex-1">${esc(p.name)}</span>
            <span data-world-thumb-id="${p.id}" aria-hidden="true"></span>
          </button>`
        )
        .join("");

      worldSuggestionIndex = 0;
      input.setAttribute("aria-activedescendant", `world-suggestion-${matches[0].id}`);

      await Promise.all(
        matches.map(async p => {
          try {
            const data = await pokemon(p.id);
            const url = sprite(data);
            if (version === worldSuggestionVersion && url) {
              const holder = document.querySelector(`[data-world-thumb-id="${p.id}"]`);
              if (holder) holder.innerHTML = img(url, p.name, "w-10 h-10 object-contain sprite");
            }
          } catch {}
        })
      );
    }, 220);
  }

  function chooseWorldSuggestion(id) {
    const match = entries.find(p => p.id === id);
    if (!match) return;
    $("world-query").value = match.name;
    closeWorldSuggestions();
    $("world-load").click();
  }

  const favorites = () => {
    try {
      return JSON.parse(localStorage.getItem("pokedex-favorites-v1") || "[]").filter(Number.isInteger);
    } catch {
      return [];
    }
  };

  function switchView(view) {
    document.querySelectorAll(".view").forEach(e => {
      e.hidden = e.id !== view + "-view";
    });
    document.querySelectorAll(".navbtn").forEach(b => {
      b.classList.toggle("active", b.dataset.view === view);
      if (b.dataset.view === view) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });

    if (view !== "world" && world.playing) pauseWorld(true);
    if (view === "world" && world.playing) drawWorld();
    if (view === "favorites") renderFavorites();
    if (view === "compare") renderCompare();
  }

  document.querySelectorAll(".navbtn").forEach(b =>
    b.addEventListener("click", () => switchView(b.dataset.view))
  );

  function card(p) {
    return `
      <article class="card">
        <div class="poke-img h-32 sm:h-40">${img(art(p), p.name, "w-full h-full object-contain p-3")}</div>
        <div class="p-3">
          <p class="mono text-xs text-[#53677b]">#${p.id}</p>
          <h3 class="font-extrabold capitalize truncate">${esc(p.name)}</h3>
          <div class="flex gap-1 flex-wrap my-2">${badges(p)}</div>
          <div class="flex flex-wrap gap-2">
            <button class="secondary !p-2 !text-xs" data-action="open" data-id="${p.id}" type="button">Detalhes</button>
            <button class="secondary !p-2 !text-xs" data-action="favorite" data-id="${p.id}" type="button"></button>
            <button class="secondary !p-2 !text-xs" data-action="compare" data-id="${p.id}" type="button"></button>
          </div>
        </div>
      </article>`;
  }

  function refreshActions() {
    document.querySelectorAll('[data-action="favorite"]').forEach(b => {
      const yes = favorites().includes(+b.dataset.id);
      b.textContent = yes ? "♥ Salvo" : "♡ Favorito";
      b.setAttribute("aria-pressed", String(yes));
    });
    document.querySelectorAll('[data-action="compare"]').forEach(b => {
      const yes = compared.some(p => p.id === +b.dataset.id);
      b.textContent = yes ? "✓ Comparando" : "Comparar";
      b.setAttribute("aria-pressed", String(yes));
    });
  }

  async function showPokemon(q) {
    switchView("search");
    const version = ++detailVersion;
    message("detail-status", "Consultando a PokéAPI...");
    $("detail").replaceChildren();

    try {
      const p = await pokemon(q);
      if (version !== detailVersion) return;

      message("detail-status", "");
      $("detail").innerHTML = `
        <article class="panel p-5 md:p-7">
          <div class="grid md:grid-cols-[38%_1fr] gap-6">
            <div>${img(art(p), p.name, "poke-img w-full h-64 object-contain rounded-xl")}</div>
            <div>
              <p class="mono">Nº ${p.id}</p>
              <h2 class="font-extrabold capitalize text-3xl my-2">${esc(p.name)}</h2>
              <div class="flex gap-1 mb-4">${badges(p)}</div>
              <button class="secondary mr-2" data-action="favorite" data-id="${p.id}" type="button"></button>
              <button class="secondary" data-action="compare" data-id="${p.id}" type="button"></button>
              <p class="my-4">Altura: ${(p.height / 10).toFixed(1)} m · Peso: ${(p.weight / 10).toFixed(1)} kg</p>
              <h3 class="font-bold">Estatísticas base</h3>
              ${stats(p)}
            </div>
          </div>
          <div class="border-t-2 border-[#b7cad0] mt-6 pt-5">
            <h3 class="font-bold">Espécie e evoluções</h3>
            <div id="species-detail" aria-live="polite">Consultando espécie...</div>
          </div>
        </article>`;

      refreshActions();

      try {
        const species = await api("/pokemon-species/" + p.id);
        if (version !== detailVersion) return;

        const flavor =
          species.flavor_text_entries?.find(x => x.language.name === "pt") ||
          species.flavor_text_entries?.find(x => x.language.name === "en");

        $("species-detail").textContent = (flavor?.flavor_text || "Descrição indisponível.").replace(/\s+/g, " ");

        if (species.evolution_chain?.url) {
          const chainId = species.evolution_chain.url.match(/\/(\d+)\/?$/)?.[1];
          if (chainId) {
            const chain = await api("/evolution-chain/" + chainId);
            if (version !== detailVersion) return;
            const stages = [];
            function walk(node) {
              stages.push(node.species.name);
              (node.evolves_to || []).forEach(walk);
            }
            walk(chain.chain);
            $("species-detail").append(
              document.createElement("br"),
              document.createTextNode("Evoluções: " + stages.join(" → "))
            );
          }
        }
      } catch {
        if (version === detailVersion) {
          $("species-detail").textContent = "Dados da espécie indisponíveis no momento.";
        }
      }
    } catch (e) {
      if (version === detailVersion) message("detail-status", e.message);
    }
  }

  async function loadCatalog() {
    message("list-status", "Carregando catálogo...");
    try {
      const first = await api("/pokemon?limit=1&offset=0");
      const all = await api("/pokemon?limit=" + first.count + "&offset=0");
      entries = all.results
        .map(p => ({
          name: p.name,
          id: Number(p.url.match(/\/(\d+)\/?$/)?.[1])
        }))
        .filter(p => p.id);
      applyFilters();
    } catch (e) {
      message("list-status", e.message);
    }

    try {
      const t = await api("/type");
      t.results
        .filter(x => names[x.name])
        .forEach(x => {
          const o = document.createElement("option");
          o.value = x.name;
          o.textContent = names[x.name];
          $("type-filter").append(o);
        });
    } catch {}
  }

  function applyFilters() {
    const q = norm($("list-query").value);
    filtered = entries.filter(
      p => (!q || p.name.includes(q) || String(p.id).includes(q)) && (!selectedType || typeIds?.has(p.id))
    );
    page = 1;
    renderList();
  }

  async function renderList() {
    const version = ++listVersion;
    const pages = Math.max(1, Math.ceil(filtered.length / 20));
    page = Math.max(1, Math.min(page, pages));

    $("prev-btn").disabled = page === 1;
    $("next-btn").disabled = page === pages;
    message("page-info", `Página ${page} de ${pages}. ${filtered.length} resultados`);

    if (!filtered.length) {
      $("catalog").replaceChildren();
      message("list-status", entries.length ? "Nenhum resultado." : "Carregando catálogo...");
      return;
    }

    message("list-status", "Carregando Pokémon...");
    const result = await Promise.allSettled(filtered.slice((page - 1) * 20, page * 20).map(x => pokemon(x.id)));
    if (version !== listVersion) return;

    $("catalog").innerHTML = result
      .filter(x => x.status === "fulfilled")
      .map(x => card(x.value))
      .join("");
    refreshActions();
    message("list-status", result.some(x => x.status === "rejected") ? "Alguns Pokémon não puderam ser carregados." : "");
  }

  async function renderFavorites() {
    const ids = favorites();
    $("favorites-list").replaceChildren();

    if (!ids.length) {
      message("favorites-status", "Nenhum favorito adicionado ainda.");
      return;
    }

    message("favorites-status", "Carregando favoritos...");
    const result = await Promise.allSettled(ids.map(id => pokemon(id)));
    $("favorites-list").innerHTML = result
      .filter(x => x.status === "fulfilled")
      .map(x => card(x.value))
      .join("");
    refreshActions();
    message("favorites-status", "");
  }

  function renderCompare() {
    $("compare-list").innerHTML = compared.length
      ? compared
          .map(
            p => `
            <article class="panel p-5">
              <div class="flex justify-between items-center mb-3">
                <span class="mono">#${p.id}</span>
                <button class="secondary !p-2 !text-xs" data-action="remove-compare" data-id="${p.id}" type="button">Remover</button>
              </div>
              ${img(art(p), p.name, "poke-img w-full h-44 object-contain rounded-lg")}
              <h3 class="font-extrabold capitalize text-xl mt-3">${esc(p.name)}</h3>
              <div class="flex gap-1 my-2">${badges(p)}</div>
              ${stats(p)}
            </article>`
          )
          .join("")
      : '<p class="panel p-5">Selecione até dois Pokémon na Pesquisa ou nos Favoritos.</p>';
  }

  document.addEventListener("click", async e => {
    if (!e.target.closest("#pokemon-query,#pokemon-suggestions")) closeSuggestions();
    if (!e.target.closest("#world-query,#world-suggestions")) closeWorldSuggestions();

    const b = e.target.closest("[data-action]");
    if (!b) return;

    const id = +b.dataset.id;
    const action = b.dataset.action;

    if (action === "open") {
      showPokemon(id);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    if (action === "favorite") {
      const old = favorites();
      const yes = !old.includes(id);
      try {
        localStorage.setItem("pokedex-favorites-v1", JSON.stringify(yes ? [...old, id] : old.filter(x => x !== id)));
        refreshActions();
        if (!$("favorites-view").hidden) renderFavorites();
      } catch {
        message("detail-status", "Não foi possível salvar favoritos neste navegador.");
      }
    }

    if (action === "remove-compare") {
      compared = compared.filter(x => x.id !== id);
      renderCompare();
      refreshActions();
    }

    if (action === "compare") {
      if (compared.some(p => p.id === id)) {
        compared = compared.filter(p => p.id !== id);
      } else if (compared.length < 2) {
        try {
          compared.push(await pokemon(id));
        } catch (err) {
          message("detail-status", err.message);
        }
      } else {
        message("detail-status", "Remova um Pokémon da comparação primeiro.");
        return;
      }
      renderCompare();
      refreshActions();
    }
  });

  $("pokemon-query").addEventListener("input", updateSuggestions);
  $("pokemon-query").addEventListener("keydown", e => {
    const box = $("pokemon-suggestions");
    const items = [...box.querySelectorAll("[data-suggestion-id]")];
    if (e.key === "Escape") {
      closeSuggestions();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!items.length) return;
      e.preventDefault();
      suggestionIndex = (suggestionIndex + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items.forEach((item, i) => item.setAttribute("aria-selected", String(i === suggestionIndex)));
      $("pokemon-query").setAttribute("aria-activedescendant", items[suggestionIndex].id);
      items[suggestionIndex].scrollIntoView({ block: "nearest" });
      return;
    }
    if (e.key === "Enter" && suggestionIndex >= 0 && items[suggestionIndex]) {
      e.preventDefault();
      chooseSuggestion(+items[suggestionIndex].dataset.suggestionId);
    }
  });

  $("pokemon-suggestions").addEventListener("click", e => {
    const item = e.target.closest("[data-suggestion-id]");
    if (item) chooseSuggestion(+item.dataset.suggestionId);
  });

  $("search-form").addEventListener("submit", e => {
    e.preventDefault();
    const q = norm($("pokemon-query").value);
    closeSuggestions();
    if (q) showPokemon(q);
    else message("detail-status", "Digite um nome ou número.");
  });

  $("random-btn").addEventListener("click", async () => {
    try {
      const count = entries.length || (await api("/pokemon?limit=1&offset=0")).count;
      showPokemon(entries.length ? entries[Math.floor(Math.random() * count)].id : Math.floor(Math.random() * count) + 1);
    } catch (e) {
      message("detail-status", e.message);
      switchView("search");
    }
  });

  $("list-query").addEventListener("input", applyFilters);
  $("type-filter").addEventListener("change", async e => {
    selectedType = e.target.value;
    typeIds = null;
    if (selectedType) {
      try {
        const current = selectedType;
        const result = await api("/type/" + current);
        if (current !== selectedType) return;
        typeIds = new Set(result.pokemon.map(x => Number(x.pokemon.url.match(/\/(\d+)\/?$/)?.[1])));
      } catch (err) {
        selectedType = "";
        e.target.value = "";
        message("list-status", err.message);
      }
    }
    applyFilters();
  });

  $("prev-btn").addEventListener("click", () => {
    page--;
    renderList();
  });

  $("next-btn").addEventListener("click", () => {
    page++;
    renderList();
  });

  // BATALHA
  for (let i = 0; i < 4; i++) {
    const host = $(i < 2 ? "team-input-one" : "team-input-two");
    const form = document.createElement("form");
    form.className = "fighter-form mb-4";
    form.dataset.slot = i;
    form.hidden = i % 2 === 1;
    form.innerHTML = `
      <label for="fighter-${i}" class="block font-bold mb-1">Pokémon ${(i % 2) + 1}</label>
      <div class="flex gap-2">
        <input id="fighter-${i}" class="field" autocomplete="off" placeholder="Nome ou número">
        <button class="secondary" type="submit">Escolher</button>
      </div>
      <div id="fighter-status-${i}" class="text-sm mt-2" role="status"></div>`;
    host.append(form);

    form.addEventListener("submit", async e => {
      e.preventDefault();
      const button = e.currentTarget.querySelector("button");
      const q = norm($("fighter-" + i).value);
      chosen[i] = null;
      if (!q) {
        message("fighter-status-" + i, "Digite um nome ou número.");
        return;
      }
      button.disabled = true;
      message("fighter-status-" + i, "Consultando...");
      try {
        chosen[i] = await pokemon(q);
        message("fighter-status-" + i, chosen[i].name + " selecionado.");
      } catch (err) {
        message("fighter-status-" + i, err.message);
      } finally {
        button.disabled = false;
      }
    });
  }

  $("battle-format").addEventListener("change", e =>
    document.querySelectorAll(".fighter-form").forEach(f => {
      if (+f.dataset.slot % 2) f.hidden = e.target.value !== "2";
    })
  );

  function stopBattle() {
    clearTimeout(battleTimer);
    battleTimer = 0;
  }

  function battleTurn() {
    if (!battle || battle.paused) return;
    const live = battle.fighters.filter(f => f.hp > 0);
    const teams = new Set(live.map(f => f.team));

    if (teams.size < 2 || battle.turn >= 120) {
      message("battle-status", teams.size === 1 ? `Treinador ${live[0].team} venceu!` : "Batalha encerrada em empate.");
      stopBattle();
      $("battle-pause").hidden = true;
      return;
    }

    const attacker = live[battle.turn % live.length];
    const target = live.find(f => f.team !== attacker.team);
    const attack = attacker.p.stats.find(s => s.stat.name === "attack")?.base_stat || 40;
    const defense = target.p.stats.find(s => s.stat.name === "defense")?.base_stat || 40;
    const damage = Math.max(1, Math.floor(((12 + attack * 0.22) * attack) / (defense + 35)));

    target.hp = Math.max(0, target.hp - damage);
    const li = document.createElement("li");
    li.textContent = `Turno ${++battle.turn}: ${attacker.p.name} atingiu ${target.p.name} (${damage} de dano; ${target.hp} HP restantes).`;
    $("battle-log").append(li);

    battleTimer = setTimeout(
      battleTurn,
      matchMedia("(prefers-reduced-motion: reduce)").matches ? 250 : 850
    );
  }

  $("battle-start").addEventListener("click", () => {
    const slots = $("battle-format").value === "2" ? [0, 1, 2, 3] : [0, 2];
    const missing = slots.find(i => !chosen[i]);
    if (missing !== undefined) {
      message("battle-status", "Escolha todos os Pokémon antes de começar.");
      $("fighter-" + missing).focus();
      return;
    }

    stopBattle();
    battle = {
      fighters: slots.map(i => ({
        team: i < 2 ? 1 : 2,
        p: chosen[i],
        hp: 2 * (chosen[i].stats.find(s => s.stat.name === "hp")?.base_stat || 40) + 40
      })),
      turn: 0,
      paused: false
    };

    $("battle-log").replaceChildren();
    message("battle-status", "Batalha recreativa iniciada.");
    $("battle-pause").hidden = false;
    $("battle-reset").hidden = false;
    $("battle-pause").textContent = "Pausar";
    battleTimer = setTimeout(battleTurn, 850);
  });

  $("battle-pause").addEventListener("click", () => {
    if (!battle) return;
    battle.paused = !battle.paused;
    $("battle-pause").textContent = battle.paused ? "Continuar" : "Pausar";
    stopBattle();
    if (!battle.paused) battleTimer = setTimeout(battleTurn, 400);
  });

  $("battle-reset").addEventListener("click", () => $("battle-start").click());

  // TESTES
  $("run-tests").addEventListener("click", () => {
    const tests = [
      ["Normalização", norm(" PIKACHU ") === "pikachu"],
      ["Grade do mundo", map.every(row => row.length === MW)],
      ["Ponto inicial transitável", !solid(5, 20)],
      ["Limite da câmera", Math.max(0, Math.min(0, 5)) === 0],
      ["Paginação", Math.ceil(41 / 20) === 3]
    ];
    $("test-results").innerHTML = tests
      .map(([title, ok]) => `<p><strong>${ok ? "APROVADO" : "REPROVADO"}</strong> ${title}</p>`)
      .join("");
  });

  // MUNDO ABERTO
  const raw = [
    "#..........................................#",
    "#..H..T....T....T.....T...~~~~~~~~~~~~.....#",
    "#.....T.........T.........~~~~~~~~~~~~.....#",
    "#..S............T.....T...~~~~~~~~~~~~.....#",
    "#..T...T..................~~~~~~~~~~~~.....#",
    "#..F........T.............~~~~~~~~~~~~.....#",
    "#...........T.............~~~~~~~~~~~~.....#",
    "#...........T...T.........~~~~~~~~~~~~.....#",
    "#..H...T.....F............~~~~~~~~~~~~.....#",
    "#...........T.............============.....#",
    "#...........T....T........============.....#",
    "#..S........T.............~~~~~~~~~~~~.....#",
    "#...........T....T........~~~~~~~~~~~~.....#",
    "#...........T....T........~~~~~~~~~~~~.....#",
    "#.....T.....T....T........~~~~~~~~~~~~.....#",
    "#...........T.............~~~~~~~~~~~~.....#",
    "#...FFFF....T......T......T....T...........#",
    "#...........T.............T....T...........#",
    "#...........T.............T................#",
    "#....S......T.............T....H...........#",
    "#...........T.............T................#",
    "#.....T.....T.............T....S...........#",
    "#.....T.....T..............................#",
    "#.....T.....T.............T.....T..........#",
    "#.....T.....T.............T.....T..........#",
    "#...........T......T....F.......T..........#",
    "#T..........T...................T..........#",
    "#...........T...................T..........#",
    "#...........T......T............T..........#"
  ];

  const MW = 44;
  const MH = raw.length;
  const T = 16;
  const map = raw.map(row => row.padEnd(MW, "#").slice(0, MW).split(""));

  function paintRoad() {
    for (let x = 4; x <= 36; x++) {
      for (let y = 19; y <= 21; y++) {
        if (map[y]?.[x] !== undefined && !["~", "=", "H", "S"].includes(map[y][x])) map[y][x] = "p";
      }
    }
    for (let y = 4; y <= 24; y++) {
      for (let x = 4; x <= 6; x++) {
        if (map[y]?.[x] && !["H", "S"].includes(map[y][x])) map[y][x] = "p";
      }
    }
    for (let y = 9; y <= 20; y++) {
      for (let x = 22; x <= 24; x++) {
        if (map[y]?.[x] && !["~", "="].includes(map[y][x])) map[y][x] = "p";
      }
    }
    for (let x = 24; x <= 37; x++) {
      for (let y = 9; y <= 10; y++) {
        if (map[y]?.[x] && map[y][x] !== "=") map[y][x] = "p";
      }
    }
  }
  paintRoad();

  const points = [
    { x: 5, y: 4, text: "Placa da Vila do Cedro: siga pela trilha até o lago." },
    { x: 5, y: 12, text: "Bosque do Musgo: a ponte liga as duas margens." },
    { x: 5, y: 20, text: "Rota das Flores: uma trilha tranquila começa aqui." },
    { x: 36, y: 22, text: "Clareira do Sol: um lugar para descansar." },
    { x: 36, y: 9, text: "Ponte do Lago: atravesse para chegar à clareira." },
    { x: 4, y: 9, text: "Casa do Cedro: as janelas estão iluminadas." },
    { x: 36, y: 20, text: "Cabana da Clareira: um pequeno refúgio à beira da rota." }
  ];

  const solid = (x, y) => x < 0 || y < 0 || x >= MW || y >= MH || ["#", "T", "H", "~", "F"].includes(map[y][x]);

  const canvas = $("world-canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = false;

  const world = {
    pokemon: null,
    image: null,
    playing: false,
    paused: false,
    x: 5,
    y: 20,
    toX: 5,
    toY: 20,
    progress: 0,
    facing: "down",
    steps: 0,
    pressed: [],
    raf: 0,
    last: 0,
    area: "",
    reduce: false,
    cameraX: 0,
    cameraY: 0
  };

  let worldVersion = 0;

  $("world-query").addEventListener("input", () => {
    worldVersion++;
    world.pokemon = null;
    world.image = null;
    $("world-enter").disabled = true;
    $("world-picked").hidden = true;
    updateWorldSuggestions();
  });

  $("world-query").addEventListener("keydown", e => {
    const box = $("world-suggestions");
    const items = [...box.querySelectorAll("[data-world-suggestion-id]")];
    if (e.key === "Escape") {
      closeWorldSuggestions();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!items.length) return;
      e.preventDefault();
      worldSuggestionIndex = (worldSuggestionIndex + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items.forEach((item, i) => item.setAttribute("aria-selected", String(i === worldSuggestionIndex)));
      $("world-query").setAttribute("aria-activedescendant", items[worldSuggestionIndex].id);
      items[worldSuggestionIndex].scrollIntoView({ block: "nearest" });
      return;
    }
    if (e.key === "Enter" && worldSuggestionIndex >= 0 && items[worldSuggestionIndex]) {
      e.preventDefault();
      chooseWorldSuggestion(+items[worldSuggestionIndex].dataset.worldSuggestionId);
    }
  });

  $("world-suggestions").addEventListener("click", e => {
    const item = e.target.closest("[data-world-suggestion-id]");
    if (item) chooseWorldSuggestion(+item.dataset.worldSuggestionId);
  });

  $("world-form").addEventListener("submit", async e => {
    e.preventDefault();
    const q = norm($("world-query").value);
    const v = ++worldVersion;
    const b = $("world-load");

    if (!q) {
      message("world-status", "Digite um nome ou número.");
      return;
    }

    b.disabled = true;
    message("world-status", "Carregando Pokémon da PokéAPI...");

    try {
      const p = await pokemon(q);
      const url = sprite(p);
      if (!url || !url.startsWith("https://")) throw Error("Sprite indisponível para este Pokémon.");

      const image = new Image();
      image.crossOrigin = "anonymous";
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(Error("Não foi possível carregar o sprite."));
        image.src = url;
      });

      if (v !== worldVersion) return;

      world.pokemon = p;
      world.image = image;
      $("world-selected-image").innerHTML = img(url, p.name, "w-full h-full object-contain sprite");
      message("world-selected-name", `#${p.id} ${p.name}`);
      $("world-selected-types").innerHTML = badges(p);
      $("world-picked").hidden = false;
      $("world-enter").disabled = false;
      message("world-status", "Pokémon carregado. A rota está pronta para explorar.");
    } catch (err) {
      if (v === worldVersion) message("world-status", err.message);
    } finally {
      b.disabled = false;
    }
  });

  function say(text) {
    message("world-message", text);
  }

  function areaAt(x, y) {
    if (x >= 29 && y <= 16) return "Lago das Pontes";
    if (x >= 29) return "Clareira do Sol";
    if (y <= 11) return "Vila do Cedro";
    if (x <= 17) return "Bosque do Musgo";
    return "Rota das Flores";
  }

  function areaUpdate() {
    const a = areaAt(world.x, world.y);
    if (a !== world.area) {
      world.area = a;
      message("world-area", a);
      say(`Você chegou a ${a}.`);
      if (!world.reduce && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        $("world-frame").classList.remove("entering");
        void $("world-frame").offsetWidth;
        $("world-frame").classList.add("entering");
      }
    }
  }

  function interact() {
    if (!world.playing || world.paused) return;
    const dir = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[world.facing];
    const point = points.find(
      p => Math.abs(p.x - world.x) + Math.abs(p.y - world.y) <= 1 || (p.x === world.x + dir[0] && p.y === world.y + dir[1])
    );
    say(point ? point.text : "A trilha continua. Explore e aproxime-se de placas ou casas.");
  }

  $("world-interact").addEventListener("click", interact);

  function pauseWorld(v) {
    world.paused = v;
    world.pressed = [];
    $("world-overlay").hidden = !v;
    $("world-pause").setAttribute("aria-pressed", String(v));
    $("world-pause").querySelector(".pause-word").hidden = v;
    $("world-pause").querySelector(".resume-word").hidden = !v;

    if (v) {
      cancelAnimationFrame(world.raf);
      world.raf = 0;
      world.last = 0;
    } else if (world.playing) {
      startLoop();
    }
    if (world.playing) drawWorld();
  }

  $("world-pause").addEventListener("click", () => pauseWorld(!world.paused));

  $("world-enter").addEventListener("click", () => {
    if (!world.pokemon || !world.image) return;
    world.playing = true;
    world.x = world.toX = 5;
    world.y = world.toY = 20;
    world.progress = 0;
    world.steps = 0;
    world.facing = "down";
    world.area = "";

    $("world-selection").hidden = true;
    $("world-play").hidden = false;
    $("world-hud-image").innerHTML = img(sprite(world.pokemon), world.pokemon.name, "w-full h-full object-contain sprite");
    message("world-hud-name", world.pokemon.name);
    $("world-hud-types").innerHTML = badges(world.pokemon);

    pauseWorld(false);
    areaUpdate();
    say("Bem-vindo à rota! Use as setas, WASD ou os controles touch. Interaja com placas e casas.");
    drawWorld();
    canvas.focus({ preventScroll: true });
  });

  $("world-exit").addEventListener("click", () => {
    pauseWorld(true);
    world.playing = false;
    $("world-play").hidden = true;
    $("world-selection").hidden = false;
    message("world-status", "Você saiu do mundo. Seu Pokémon permanece selecionado.");
    $("world-enter").focus();
  });

  $("world-reduce").addEventListener("change", e => {
    world.reduce = e.target.checked;
    drawWorld();
  });

  function direction() {
    return world.pressed.at(-1);
  }

  function move(dt) {
    if (world.progress > 0) {
      const speed = world.reduce || matchMedia("(prefers-reduced-motion: reduce)").matches ? 100 : 165;
      world.progress = Math.min(1, world.progress + dt / speed);
      if (world.progress >= 1) {
        world.x = world.toX;
        world.y = world.toY;
        world.progress = 0;
        world.steps++;
        areaUpdate();
        const p = points.find(pt => pt.x === world.x && pt.y === world.y);
        if (p) say(p.text);
      }
      return;
    }

    const d = direction();
    if (!d) return;
    const [dx, dy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[d];
    const nx = world.x + dx;
    const ny = world.y + dy;

    if (solid(nx, ny)) return;
    if (d === "left" || d === "right") world.facing = d;
    world.toX = nx;
    world.toY = ny;
    world.progress = 0.001;
  }

  function rect(x, y, w, h, c) {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
  }

  function tile(x, y, c, time) {
    const X = x * T;
    const Y = y * T;
    const seed = (x * 13 + y * 17) % 11;

    rect(X, Y, 16, 16, (x + y) % 3 ? "#70b658" : "#79bc5d");
    rect(X, Y + 14, 16, 2, "#5b9d4b");

    if (c === "p") {
      rect(X, Y, 16, 16, "#d5b47a");
      rect(X, Y + 13, 16, 3, "#bc9466");
      if (seed < 5) rect(X + 4, Y + 5, 2, 1, "#a77e55");
    } else if (c === "~") {
      rect(X, Y, 16, 16, "#478fb2");
      rect(X, Y + 12, 16, 4, "#347b9d");
      if ((!world.reduce && !matchMedia("(prefers-reduced-motion: reduce)").matches) || seed % 2) {
        rect(X + 3 + ((Math.floor(time / 700) + seed) % 3), Y + 5, 6, 1, "#8bd2d1");
      }
    } else if (c === "=") {
      rect(X, Y, 16, 16, "#478fb2");
      rect(X, Y + 2, 16, 12, "#ac7848");
      rect(X, Y + 4, 16, 2, "#dbaf70");
      rect(X, Y + 11, 16, 2, "#6e513c");
    } else if (c === "F") {
      rect(X + 2, Y + 7, 12, 7, "#438b49");
      rect(X + 5, Y + 3, 3, 5, "#eac95e");
      rect(X + 9, Y + 8, 3, 3, "#ed8b76");
    } else if (c === "S") {
      rect(X + 6, Y + 7, 4, 9, "#76523c");
      rect(X + 2, Y + 2, 12, 8, "#f7e7a8");
      rect(X + 3, Y + 3, 10, 1, "#a36947");
      rect(X + 7, Y + 5, 2, 3, "#72553c");
    } else if (c === "H") {
      rect(X + 1, Y + 8, 14, 8, "#e9d5a5");
      rect(X + 1, Y + 4, 14, 5, "#af564d");
      rect(X + 4, Y + 1, 8, 4, "#ce7960");
      rect(X + 6, Y + 10, 4, 6, "#604f43");
    } else if (c === "T") {
      rect(X + 6, Y + 9, 4, 7, "#75523c");
      rect(X + 1, Y + 3, 14, 10, "#285f46");
      rect(X + 3, Y + 1, 10, 11, "#41835a");
      rect(X + 4, Y + 4, 5, 2, "#66a66a");
    } else if (c === "#") {
      rect(X, Y, 16, 16, "#315b43");
      rect(X, Y + 3, 16, 3, "#477854");
      rect(X + 3, Y + 9, 10, 5, "#254b39");
    } else {
      if (seed < 5) {
        rect(X + 4, Y + 9, 1, 3, "#4e9949");
        rect(X + 7, Y + 7, 1, 4, "#4e9949");
      }
      if (seed === 9) {
        rect(X + 10, Y + 7, 2, 2, "#f8d470");
        rect(X + 11, Y + 6, 1, 1, "#f3f0c5");
      }
    }
  }

  function drawWorld(time = 0) {
    if (!world.playing) return;
    const w = canvas.width;
    const h = canvas.height;
    const px = (world.x + (world.toX - world.x) * world.progress) * T;
    const py = (world.y + (world.toY - world.y) * world.progress) * T;

    world.cameraX = Math.max(0, Math.min(MW * T - w, Math.round(px - w / 2 + 8)));
    world.cameraY = Math.max(0, Math.min(MH * T - h, Math.round(py - h / 2 + 8)));

    ctx.imageSmoothingEnabled = false;
    rect(0, 0, w, h, "#315b43");
    ctx.save();
    ctx.translate(-world.cameraX, -world.cameraY);

    const minX = Math.max(0, Math.floor(world.cameraX / T) - 1);
    const maxX = Math.min(MW, Math.ceil((world.cameraX + w) / T) + 1);
    const minY = Math.max(0, Math.floor(world.cameraY / T) - 1);
    const maxY = Math.min(MH, Math.ceil((world.cameraY + h) / T) + 1);

    for (let y = minY; y < maxY; y++) {
      for (let x = minX; x < maxX; x++) {
        tile(x, y, map[y][x], time);
      }
    }

    const actors = [];
    for (let y = minY; y < maxY; y++) {
      for (let x = minX; x < maxX; x++) {
        if (map[y][x] === "T" || map[y][x] === "H") {
          actors.push({ kind: map[y][x], x, y, depth: y * T + 16 });
        }
      }
    }
    actors.push({ kind: "player", depth: py + 14 });
    actors.sort((a, b) => a.depth - b.depth);

    for (const o of actors) {
      if (o.kind !== "player") {
        tile(o.x, o.y, map[o.y][o.x], time);
        continue;
      }

      rect(px + 3, py + 12, 10, 3, "#2d513d");
      if (world.image) {
        const image = world.image;
        const width = Math.max(14, Math.min(23, image.naturalWidth));
        const height = Math.max(14, Math.min(23, image.naturalHeight));
        const bob =
          world.progress &&
          !world.reduce &&
          !matchMedia("(prefers-reduced-motion: reduce)").matches &&
          Math.floor(world.progress * 4) % 2
            ? -1
            : 0;

        ctx.save();
        if (world.facing === "left") {
          ctx.translate(Math.round(px) + 16, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(image, Math.round((16 - width) / 2), Math.round(py + 13 - height + bob), width, height);
        } else {
          ctx.drawImage(image, Math.round(px + (16 - width) / 2), Math.round(py + 13 - height + bob), width, height);
        }
        ctx.restore();
      }
    }

    ctx.restore();
  }

  function startLoop() {
    if (world.raf || !world.playing || world.paused || $("world-view").hidden) return;
    world.raf = requestAnimationFrame(function frame(now) {
      world.raf = 0;
      if (!world.playing || world.paused || $("world-view").hidden) return;
      move(Math.min(40, world.last ? now - world.last : 16));
      world.last = now;
      drawWorld(now);
      world.raf = requestAnimationFrame(frame);
    });
  }

  const keys = {
    w: "up",
    arrowup: "up",
    s: "down",
    arrowdown: "down",
    a: "left",
    arrowleft: "left",
    d: "right",
    arrowright: "right"
  };

  function setDir(d, on) {
    world.pressed = world.pressed.filter(x => x !== d);
    if (on) {
      world.pressed.push(d);
      drawWorld();
      startLoop();
    }
  }

  document.addEventListener("keydown", e => {
    if (
      !world.playing ||
      world.paused ||
      $("world-view").hidden ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)
    ) {
      return;
    }

    const d = keys[e.key.toLowerCase()];
    if (d) {
      e.preventDefault();
      if (!e.repeat) setDir(d, true);
    } else if (e.key === " " || e.key.toLowerCase() === "e") {
      e.preventDefault();
      interact();
    }
  });

  document.addEventListener("keyup", e => {
    const d = keys[e.key.toLowerCase()];
    if (d) setDir(d, false);
  });

  document.querySelectorAll("[data-direction]").forEach(b => {
    const d = b.dataset.direction;
    b.addEventListener("pointerdown", e => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      if (world.playing && !world.paused) setDir(d, true);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      b.addEventListener(type, () => setDir(d, false));
    }
  });

  window.addEventListener("blur", () => {
    if (world.playing && !world.paused) pauseWorld(true);
  });

  renderCompare();
  loadCatalog();
})();

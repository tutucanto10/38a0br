#!/usr/bin/env node
/**
 * baixar_fotos.js
 * Baixa fotos dos ~60 jogadores famosos da Wikipedia.
 * Salva em: faces/{time}-{ano}/{nome}.jpg
 *
 * Uso:
 *   node baixar_fotos.js            → pula arquivos existentes
 *   node baixar_fotos.js --forca    → rebaixa mesmo se arquivo existe
 *   node baixar_fotos.js --limpar   → apaga fotos de não-famosos, depois baixa
 */

const fs   = require("fs");
const path = require("path");
const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf-8");

const FORCE  = process.argv.includes("--forca");
const LIMPAR = process.argv.includes("--limpar");

// ─── slugify (igual ao do jogo) ──────────────────────────────────────────────
function slugify(s) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
          .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ─── Apenas jogadores famosos têm foto ───────────────────────────────────────
const FAMOSOS = new Set([
  // Lendas absolutas
  "Pelé","Garrincha","Zico","Romário","Ronaldinho Gaúcho","Falcão",
  // Copa 94 / clássicos modernos
  "Roberto Carlos","Cafu","Rivaldo","Bebeto","Taffarel","Edmundo",
  // Era 58-70
  "Nilton Santos","Didi","Jairzinho","Gérson","Carlos Alberto",
  "Zagallo","Amarildo","Tostão","Dirceu Lopes","Piazza","Leivinha","Ademir da Guia",
  // Flamengo ícones
  "Júnior","Leandro","Adílio",
  "Gabigol","De Arrascaeta","Everton Ribeiro","Bruno Henrique","Pedro","Filipe Luís","Gerson",
  // Corinthians
  "Dida","Marcelinho Carioca","Carlos Tévez","Paulinho","Cássio","Vampeta",
  // Palmeiras
  "Weverton","Dudu","Raphael Veiga","Endrick","Felipe Melo",
  // São Paulo
  "Rogério Ceni","Raí","Hernanes","Müller",
  // Santos
  "Elano","Robinho",
  // Fluminense
  "Fred","Marcelo","Conca","Germán Cano","André",
  // Vasco
  "Roberto Dinamite","Juninho Pernambucano",
  // Internacional
  "Andrés D'Alessandro",
  // Atlético-MG
  "Dadá Maravilha","Hulk",
  // Grêmio
  "Jardel","Everton Cebolinha","Arthur",
  // Athletico-PR
  "Kléberson","Lucho González","Vitor Roque",
  // Outros
  "Renato Gaúcho","David Luiz","Júlio César",
]);

// ─── --limpar: apaga fotos de não-famosos (mantém as dos famosos) ─────────────
if (LIMPAR) {
  console.log("Limpando fotos de não-famosos...");
  const facesDir = path.join(__dirname, "faces");
  if (fs.existsSync(facesDir)) {
    let removed = 0;
    const slugsFamosos = new Set([...FAMOSOS].map(slugify));
    for (const pasta of fs.readdirSync(facesDir)) {
      const pastaPath = path.join(facesDir, pasta);
      if (!fs.statSync(pastaPath).isDirectory()) continue;
      for (const arq of fs.readdirSync(pastaPath)) {
        const slug = arq.replace(/\.jpg$/, "");
        if (!slugsFamosos.has(slug)) {
          fs.unlinkSync(path.join(pastaPath, arq));
          removed++;
        }
      }
    }
    console.log(`Removidos ${removed} arquivos de não-famosos.\n`);
  }
}

// ─── Extrai o array TIMES do HTML ──────────────────────────────────────────
const match = html.match(/const TIMES\s*=\s*(\[[\s\S]*?\]);/);
if (!match) { console.error("Array TIMES não encontrado em index.html"); process.exit(1); }
const TIMES = eval(match[1]); // eslint-disable-line no-eval

// ─── Utilitários ─────────────────────────────────────────────────────────────
const DELAY_MS    = 1500;   // pausa entre jogadores
const RETRY_DELAY = 15000;  // espera após rate-limit
const MAX_RETRIES = 3;

const sleep = ms => new Promise(r => setTimeout(r, ms));

const HEADERS = { "User-Agent": "38A0BR-PhotoBot/1.0 (educational project; contact: a.canto@dommainc.com.br)" };

async function apiGet(url, tentativa = 0) {
  const r = await fetch(url, { headers: HEADERS });
  if (r.status === 429) {
    if (tentativa >= MAX_RETRIES) throw new Error("Rate limit após " + MAX_RETRIES + " tentativas");
    const wait = RETRY_DELAY * (tentativa + 1);
    process.stdout.write(`[429 – aguardando ${wait / 1000}s] `);
    await sleep(wait);
    return apiGet(url, tentativa + 1);
  }
  const text = await r.text();
  if (text.startsWith("You are")) {
    if (tentativa >= MAX_RETRIES) throw new Error("Rate limit (texto)");
    const wait = RETRY_DELAY * (tentativa + 1);
    process.stdout.write(`[ratelimit – aguardando ${wait / 1000}s] `);
    await sleep(wait);
    return apiGet(url, tentativa + 1);
  }
  return JSON.parse(text);
}

// Busca a foto direto pelo título da página (mais preciso para jogadores famosos)
async function buscarFotoPorTitulo(nome, wiki) {
  const url =
    `https://${wiki}/w/api.php?action=query` +
    `&titles=${encodeURIComponent(nome)}` +
    `&prop=pageimages&pithumbsize=400&format=json&origin=*`;
  const j    = await apiGet(url);
  const page = Object.values(j?.query?.pages || {})[0];
  if (page?.missing !== undefined) return null;
  return page?.thumbnail?.source ?? null;
}

// Títulos Wikipedia para nomes ambíguos
const WIKI_TITULO_OVERRIDE = {
  "Roberto Carlos": "Roberto Carlos (futebolista)",
  "Júlio César":    "Júlio César (futebolista)",
  "Carlos Alberto": "Carlos Alberto Torres",
  "Falcão":         "Paulo Roberto Falcão",
  "Didi":           "Didi (futebolista)",
  "Gérson":         "Gérson (futebolista)",
  "Leandro":        "Leandro (futebolista)",
  "Taffarel":       "Cláudio Taffarel",
  "Raí":            "Raí Souza Vieira de Oliveira",
};

async function buscarFoto(nome) {
  const titulo = WIKI_TITULO_OVERRIDE[nome] || nome;
  // 1. Busca direta por título (mais precisa para jogadores famosos)
  for (const wiki of ["pt.wikipedia.org", "en.wikipedia.org"]) {
    const src = await buscarFotoPorTitulo(titulo, wiki);
    if (src) return { wiki, titulo, foto: src };
    await sleep(400);
  }

  // 2. Fallback: busca por texto se o título exato não existir
  for (const wiki of ["pt.wikipedia.org", "en.wikipedia.org"]) {
    const query = `${nome} futebolista`;
    const buscaURL =
      `https://${wiki}/w/api.php?action=query&list=search` +
      `&srsearch=${encodeURIComponent(query)}&format=json&srlimit=1&origin=*`;
    const j   = await apiGet(buscaURL);
    const hit = j?.query?.search?.[0];
    if (!hit) { await sleep(400); continue; }

    await sleep(400);
    const src = await buscarFotoPorTitulo(hit.title, wiki);
    if (src) return { wiki, titulo: hit.title, foto: src };
    await sleep(400);
  }
  return null;
}

async function baixar(url, dest) {
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const ok = buf[0] === 0xFF || buf[0] === 0x89; // JPEG ou PNG
  if (!ok) throw new Error("Resposta não é imagem");
  fs.writeFileSync(dest, buf);
}

// ─── Montagem da lista (apenas famosos) ──────────────────────────────────────
const famososBaixados = new Map(); // nome → caminho da primeira cópia
const tarefas = [];

for (const t of TIMES) {
  const pasta = path.join(__dirname, "faces", `${slugify(t.time)}-${t.ano}`);
  fs.mkdirSync(pasta, { recursive: true });

  for (const jog of t.jogadores) {
    if (!FAMOSOS.has(jog.nome)) continue;
    const destJpg = path.join(pasta, `${slugify(jog.nome)}.jpg`);
    tarefas.push({ nome: jog.nome, clube: t.time, ano: t.ano, dest: destJpg });
  }
}

// ─── Execução ────────────────────────────────────────────────────────────────
const encontrados    = [];
const naoEncontrados = [];

(async () => {
  console.log(`Entradas de famosos: ${tarefas.length} (${FAMOSOS.size} jogadores únicos)`);
  if (FORCE) console.log("Modo --forca: rebaixando mesmo se arquivo existe.");

  for (let i = 0; i < tarefas.length; i++) {
    const { nome, clube, ano, dest } = tarefas[i];
    process.stdout.write(`[${i + 1}/${tarefas.length}] ${nome} (${clube} ${ano}) ... `);

    if (!FORCE && fs.existsSync(dest)) { console.log("já existe, pulando."); continue; }

    if (!FORCE && famososBaixados.has(nome)) {
      try { fs.copyFileSync(famososBaixados.get(nome), dest); console.log("copiado."); }
      catch { console.log("erro ao copiar."); }
      continue;
    }

    await sleep(DELAY_MS);

    try {
      const res = await buscarFoto(nome);
      if (res?.foto) {
        await baixar(res.foto, dest);
        famososBaixados.set(nome, dest);
        encontrados.push(`${nome} | ${clube} ${ano} | pág: ${res.titulo} [${res.wiki}]`);
        console.log(`OK [${res.titulo}]`);
      } else {
        naoEncontrados.push(`${nome} | ${clube} ${ano} | sem foto na Wikipedia`);
        console.log("sem foto");
      }
    } catch (e) {
      naoEncontrados.push(`${nome} | ${clube} ${ano} | ERRO: ${e.message}`);
      console.log(`erro (${e.message})`);
    }
  }

  const rel =
    `RELATÓRIO DE FOTOS (famosos)\n==============================\n\n` +
    `ENCONTRADOS (${encontrados.length}):\n${encontrados.join("\n")}\n\n` +
    `NÃO ENCONTRADOS (${naoEncontrados.length}):\n${naoEncontrados.join("\n")}\n`;
  fs.writeFileSync(path.join(__dirname, "relatorio_fotos.txt"), rel, "utf-8");

  console.log(`\nConcluído!`);
  console.log(`  Encontrados    : ${encontrados.length}`);
  console.log(`  Não encontrados: ${naoEncontrados.length}`);
  console.log(`  Relatório      : relatorio_fotos.txt`);
})();

import { createClient } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import { formatEther, parseEther } from "viem";

const address = window.CARROT_CONTRACT_ADDRESS || "0x7d689536B5211484856dB2BE5aA4e0f15E0Ccd30";
const explorer = "https://explorer-studio-dev.genlayer.com";
const endpoint = "https://studio-dev.genlayer.com/api";
const client = createClient({ chain: studioDevnet, endpoint });
const $ = (selector) => document.querySelector(selector);
const notice = $("#action-note");
notice.textContent = "";
const status = (message) => { notice.textContent = message; };
const wallets = new Map();
let account, provider, selected, busy = false, filter = "all";
let duels = [];
let topics = [], topicLibraryReady = false;
const now = () => Math.floor(Date.now() / 1000);
const short = (value) => value ? value.slice(0, 6) + "…" + value.slice(-4) : "等待接战";
const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const current = () => duels.find((duel) => duel.id === selected);
const read = (functionName, args = []) => client.readContract({ address, functionName, args });
const key = (duel, user = account) => `carrot:61997:${address}:${duel.id}:${user?.toLowerCase()}`;

$(".network").remove();
$(".intro p").remove();
$(".intro .pill").remove();
$(".panel-head p").remove();
$(".intro h1").textContent = "GenLayer 裁决对战";
$(".logo").textContent = "GEN / DUEL";
document.title = "GenLayer 裁决对战";
$(".privacy-note").remove();
$(".roles span:last-child").remove();
$("#jury").remove();
$("#demo-settle").hidden = true;
$("#topic-fee").previousElementSibling.remove();
$("#topic-fee").remove();
$("#argument").placeholder = "写下你的答案";
const topicInput = $("#new-topic");
topicInput.required = true;
const library = document.createElement("section");
library.className = "panel topic-library";
library.innerHTML = '<div class="panel-head"><h2>公开题库</h2></div><div class="topic-list"></div>';
$(".lobby").before(library);
const roleFields = ["角色 A", "角色 B"].map((name, index) => {
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.id = "topic-role-" + index;
  input.required = true;
  input.maxLength = 120;
  label.htmlFor = input.id;
  label.textContent = name;
  $("#topic-form .actions").before(label, input);
  return input;
});
const roleNote = document.createElement("p");
roleNote.className = "note";
$("#argument").before(roleNote);
const roleSelect = document.createElement("select");
roleSelect.id = "creator-role";
roleSelect.append(new Option("角色 A", "A"), new Option("角色 B", "B"));
const roleLabel = document.createElement("label");
roleLabel.htmlFor = roleSelect.id;
roleLabel.textContent = "我扮演";
$("#create-form .actions").before(roleLabel, roleSelect);
const navigation = document.createElement("nav");
navigation.className = "section-navigation";
navigation.innerHTML = '<a href="#topics">公开题库</a><a href="#lobby">悬赏大厅</a>';
library.before(navigation);
function showPage() {
  const inLobby = location.hash === "#lobby";
  library.hidden = inLobby;
  $(".lobby").hidden = !inLobby;
  $("#arena").hidden = !inLobby || !current();
  for (const link of navigation.querySelectorAll("a")) {
    if (link.hash === (inLobby ? "#lobby" : "#topics")) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}
window.addEventListener("hashchange", showPage);

function renderTopics() {
  const previous = topicInput.value;
  topicInput.replaceChildren(new Option("请选择题目", ""));
  const list = library.querySelector(".topic-list");
  list.replaceChildren();
  for (const topic of topics) {
    topicInput.add(new Option(topic.title, String(topic.id)));
    const card = document.createElement("article");
    const title = document.createElement("h3");
    const context = document.createElement("p");
    const roles = document.createElement("p");
    const use = document.createElement("button");
    title.textContent = topic.title;
    context.textContent = topic.context;
    roles.textContent = `A · ${topic.role_a}  /  B · ${topic.role_b}`;
    use.textContent = "用这题发起对战";
    use.className = "primary";
    use.onclick = () => { topicInput.value = String(topic.id); $("#create-dialog").showModal(); };
    card.append(title, context, roles, use);
    list.append(card);
  }
  if (topics.some((topic) => String(topic.id) === previous)) topicInput.value = previous;
  if (!topics.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = topicLibraryReady ? "暂无题目，先创建一道题。" : "暂时读不到链上题库，请稍后刷新。";
    list.append(empty);
  }
  $("#topic-open").disabled = false;
  $("#create-open").disabled = false;
}

window.addEventListener("eip6963:announceProvider", ({ detail }) => {
  if (detail?.provider && detail?.info?.name) wallets.set(detail.info.name, detail.provider);
});
window.dispatchEvent(new Event("eip6963:requestProvider"));

async function connect(wallet) {
  const [next] = await wallet.request({ method: "eth_requestAccounts" });
  if (!next) throw new Error("没有选中钱包账户");
  const chainId = "0xf22d";
  try {
    await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (error) {
    if (Number(error.code) !== 4902) throw error;
    await wallet.request({ method: "wallet_addEthereumChain", params: [{
      chainId, chainName: "GenLayer Studio Dev",
      nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
      rpcUrls: [endpoint], blockExplorerUrls: [explorer],
    }] });
  }
  provider = wallet;
  account = next;
  wallet.on?.("accountsChanged", ([nextAccount]) => {
    if (provider !== wallet) return;
    account = nextAccount;
    $("#wallet").textContent = nextAccount ? short(nextAccount) : "连接钱包";
    $("#argument").value = "";
    render();
  });
  $("#wallet").textContent = short(account);
  $("#wallet-dialog").close();
  render();
}

$("#wallet").onclick = () => {
  const list = $("#wallet-list");
  list.replaceChildren();
  const choices = wallets.size ? wallets : new Map(window.ethereum ? [["浏览器钱包", window.ethereum]] : []);
  for (const [name, wallet] of choices) {
    const button = document.createElement("button");
    button.className = "wallet-option";
    button.textContent = name;
    button.onclick = () => connect(wallet).catch((error) => { $("#wallet-help").textContent = error.message; });
    list.append(button);
  }
  $("#wallet-dialog").showModal();
};

async function refresh() {
  try {
    const count = Number(await read("get_topic_count"));
    topics = await Promise.all(Array.from({ length: Math.min(count, 100) }, async (_, index) => {
      const value = await read("get_topic", [BigInt(count - index)]);
      return value instanceof Map ? Object.fromEntries(value) : value;
    }));
    topicLibraryReady = true;
  } catch {
    topicLibraryReady = false;
  }
  renderTopics();
  const count = Number(await read("get_duel_count"));
  const ids = Array.from({ length: Math.min(count, 25) }, (_, index) => count - index);
  duels = (await Promise.all(ids.map(async (id) => {
    const value = await read("get_duel", [BigInt(id)]);
    const fields = value instanceof Map ? Object.fromEntries(value) : value;
    return { ...fields, id, stake: BigInt(fields.stake) };
  }))).filter((duel) => duel.status);
  if (!current()) selected = duels[0]?.id;
  render();
}

function render() {
  const list = $("#duel-list");
  list.replaceChildren();
  for (const duel of duels.filter((item) => filter === "all" || item.status === filter)) {
    const row = document.createElement("button");
    row.className = "duel-row" + (duel.id === selected ? " selected" : "");
    const title = document.createElement("strong");
    title.textContent = duel.title;
    const stake = document.createElement("span");
    stake.textContent = formatEther(duel.stake) + " GEN / 人";
    const state = document.createElement("span");
    state.textContent = duel.status;
    row.append(title, stake, state);
    row.onclick = () => { selected = duel.id; $("#argument").value = ""; render(); };
    list.append(row);
  }
  if (!list.children.length) list.textContent = "暂无对战";
  const duel = current();
  showPage();
  if (!duel) return;
  $("#duel-id").textContent = `挑战 #${duel.id}`;
  $("#duel-title").textContent = duel.title;
  $("#duel-prompt").textContent = duel.prompt;
  $("#author").textContent = short(duel.topic_author);
  $("#fee").textContent = "5%";
  $("#player-a").textContent = short(duel.creator);
  $("#player-b").textContent = short(duel.challenger);
  $("#arena-pot").textContent = formatEther(duel.stake * (duel.challenger ? 2n : 1n)) + " GEN";
  $("#duel-status").textContent = duel.status;
  $("#verdict-badge").textContent = duel.winner ? "胜者 " + short(duel.winner) : "";
  $("#verdict-reason").textContent = duel.reason || "";
  const own = same(account, duel.creator) ? "creator" : same(account, duel.challenger) ? "challenger" : "";
  const topic = topics.find((item) => Number(item.id) === Number(duel.topic_id));
  const creatorRole = duel.creator_role || "A";
  const challengerRole = creatorRole === "A" ? "B" : "A";
  const role = own === "creator" ? creatorRole : challengerRole;
  roleNote.textContent = `发起者：角色 ${creatorRole} · 挑战者：角色 ${challengerRole}`;
  if (own) roleNote.textContent += ` · 你是角色 ${role}`;
  const committed = own && duel[own + "_commitment"];
  const revealed = own && duel[own + "_claim"];
  const closed = now() >= Number(duel.deadline);
  const both = duel.creator_commitment && duel.challenger_commitment;
  const action = $("#primary-action");
  action.disabled = busy;
  action.onclick = null;
  const bind = (label, callback) => {
    action.textContent = label;
    action.onclick = () => run(callback);
  };
  $("#argument").disabled = !own || !!committed || closed || duel.status !== "MATCHED";
  const id = BigInt(duel.id);
  if (!account) bind("连接钱包", () => $("#wallet").click());
  else if (duel.status === "OPEN" && own && now() >= Number(duel.created_at) + 86400) bind("退回质押", () => write("reclaim_expired", [id]));
  else if (duel.status === "OPEN" && !own && now() < Number(duel.created_at) + 86400) bind("接受挑战", () => write("accept_duel", [id], duel.stake));
  else if (duel.status === "MATCHED" && own && !committed && !closed) bind("锁定答案", () => commit(duel));
  else if (duel.status === "MATCHED" && committed && !revealed && (both || closed)) bind("揭示答案", () => reveal(duel));
  else if (duel.status === "MATCHED" && (closed || (duel.creator_claim && duel.challenger_claim))) bind("结算对战", () => write("settle", [id]));
  else { action.textContent = "等待对手"; action.disabled = true; }
  updateTimer();
}

function updateTimer() {
  const duel = current();
  if (!duel) return;
  const end = duel.status === "OPEN" ? Number(duel.created_at) + 86400 : Number(duel.deadline);
  $("#timer").textContent = new Date(Math.max(0, end - now()) * 1000).toISOString().slice(11, 19);
}

async function write(functionName, args, value = 0n) {
  if (!account || !provider) throw new Error("请先连接钱包");
  const signer = createClient({ chain: studioDevnet, account, provider, endpoint });
  const request = { address, functionName, args, value };
  status("正在估算费用…");
  const estimate = await signer.estimateTransactionFeesForWrite(request);
  status("请在钱包确认");
  const hash = await signer.writeContract({
    ...request, fees: { distribution: estimate.distribution, feeValue: estimate.feeValue },
  });
  status("等待确认…");
  const receipt = await client.waitForTransactionReceipt({ hash, waitUntil: "decided" });
  if (receipt.txExecutionResultName !== "FINISHED_WITH_RETURN") {
    throw new Error(`交易结果：${receipt.txExecutionResultName || receipt.statusName || "待确认"}。交易号 ${hash}`);
  }
  if (functionName === "create_topic") location.hash = "topics";
  if (functionName.startsWith("create_duel")) location.hash = "lobby";
  await refresh();
  status(functionName === "create_topic" && !topicLibraryReady ? "题目已提交，题库暂时无法读取。请稍后刷新。" : "");
}

async function commit(duel) {
  const storageKey = key(duel);
  const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
  const claim = saved?.claim || $("#argument").value.trim().replace(/\s+/gu, " ");
  if (!claim) throw new Error("请先填写答案");
  const salt = saved?.salt || crypto.randomUUID();
  const data = new TextEncoder().encode(claim + salt);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  localStorage.setItem(storageKey, JSON.stringify({ claim, salt }));
  await write("submit_commitment", [BigInt(duel.id), hash]);
}

async function reveal(duel) {
  const saved = JSON.parse(localStorage.getItem(key(duel)) || "null");
  if (!saved) throw new Error("请用原来提交答案的浏览器揭示");
  if (!window.confirm("揭示后，答案原文可以在链上查到。继续揭示？")) return;
  await write("reveal_claim", [BigInt(duel.id), saved.claim, saved.salt]);
}

async function run(callback) {
  if (busy) return;
  busy = true;
  try { await callback(); }
  catch (error) { status(error.shortMessage || error.message); }
  finally { busy = false; render(); }
}

document.querySelectorAll("[data-close], button[value=cancel]").forEach((button) => {
  button.onclick = (event) => { event.preventDefault(); button.closest("dialog").close(); };
});
document.querySelectorAll(".tab").forEach((button) => {
  button.onclick = () => {
    filter = button.dataset.filter;
    document.querySelector(".tab.active")?.classList.remove("active");
    button.classList.add("active");
    render();
  };
});
$("#topic-open").onclick = () => $("#topic-dialog").showModal();
$("#create-open").onclick = () => {
  if (topics.length) $("#create-dialog").showModal();
  else {
    location.hash = "topics";
    status(topicLibraryReady ? "先创建一道公开题目，再发起对战。" : "暂时读不到公开题库，请稍后刷新。");
  }
};
$("#topic-form").onsubmit = (event) => {
  event.preventDefault();
  if (!account || !provider) {
    $("#topic-dialog").close();
    $("#wallet").click();
    return;
  }
  $("#topic-dialog").close();
  run(() => write("create_topic", [
    $("#topic-title").value.trim(), $("#topic-context").value.trim(),
    ...roleFields.map((input) => input.value.trim()),
  ]));
};
$("#create-form").onsubmit = (event) => {
  event.preventDefault();
  $("#create-dialog").close();
  run(() => {
    const args = [BigInt(topicInput.value), BigInt($("#new-time").value)];
    const stake = parseEther($("#new-stake").value);
    return roleSelect.value === "A" ? write("create_duel", args, stake) :
      write("create_duel_with_role", [...args, "B"], stake);
  });
};
navigation.after(notice);
notice.setAttribute("role", "status");
render();
renderTopics();
refresh().catch((error) => status("读取合约失败：" + (error.shortMessage || error.message)));
setInterval(updateTimer, 1000);
setInterval(() => { if (!busy) refresh().catch(() => {}); }, 15000);

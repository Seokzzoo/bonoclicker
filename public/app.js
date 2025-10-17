/* global localStorage, fetch */
const API = location.origin.replace(/\:$|$/, "") // same origin
let auth = { token: null, user: null }
let sessionToken = null

const el = (id) => document.getElementById(id)
const show = (id, v = true) => el(id).classList.toggle("hidden", !v)

function getOrCreateUUID() {
  let id = localStorage.getItem("uuid")
  if (!id) {
    id = (Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 21)
    localStorage.setItem("uuid", id)
  }
  return id
}

async function signup() {
  const nickname = el("nickname").value.trim().slice(0, 16) || "Guest" + Math.floor(Math.random() * 999)
  const uuid = getOrCreateUUID()
  const r = await fetch("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nickname, uuid }),
  })
  const data = await r.json()
  if (data.token) {
    auth = { token: data.token, user: data.user }
    afterLogin()
  } else {
    alert("로그인 실패: " + (data.error || ""))
  }
}

function afterLogin() {
  el("me").textContent = auth.user.nickname
  el("team").textContent = auth.user.team
  show("auth", false)
  show("status", true)
  loadDaily()
}

async function startGame() {
  const r = await fetch("/api/game/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: auth.token }),
  })
  const data = await r.json()
  if (data.error === "DAILY_LIMIT") {
    el("limitMsg").classList.remove("hidden")
    return
  }
  if (!data.sessionToken) {
    alert("시작 실패")
    return
  }
  sessionToken = data.sessionToken
  runGame(data.windowSec || 10)
}

function runGame(sec) {
  show("game", true)
  el("count").textContent = "0"
  let remain = sec * 1000
  let c = 0
  const img = el("bono")
  const click = () => {
    c++
    el("count").textContent = String(c)
  }
  img.addEventListener("click", click)
  img.addEventListener("touchstart", click, { passive: true })

  const start = performance.now()
  const tick = () => {
    remain = sec * 1000 - (performance.now() - start)
    el("timer").textContent = (Math.max(0, remain) / 1000).toFixed(2)
    if (remain <= 0) {
      img.removeEventListener("click", click)
      img.removeEventListener("touchstart", click)
      const durationMs = Math.round(performance.now() - start)
      submitResult(c, durationMs)
      return
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

async function submitResult(clicks, durationMs) {
  const r = await fetch("/api/game/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: auth.token, sessionToken, clicks, durationMs }),
  })
  const data = await r.json()
  if (data.ok) {
    alert(`기록 제출 완료! ${clicks}점`)
    show("game", false)
    loadDaily()
  } else {
    alert("제출 실패: " + (data.error || ""))
  }
}

async function loadDaily() {
  const r = await fetch("/api/leaderboard/daily")
  const data = await r.json()
  renderLB(data)
}

async function loadWeekly() {
  const r = await fetch("/api/leaderboard/weekly")
  const data = await r.json()
  renderLB(data)
}

function renderLB({ users = [], teams = [] }) {
  const u = el("lbUsers")
  u.innerHTML = ""
  users.forEach((row, i) => {
    const li = document.createElement("li")
    li.textContent = `${i + 1}. ${row.nickname} [${row.team}] — ${row.clicks}`
    u.appendChild(li)
  })

  const t = el("lbTeams")
  t.innerHTML = ""
  teams
    .sort((a, b) => b.clicks - a.clicks)
    .forEach((row, i) => {
      const li = document.createElement("li")
      li.textContent = `${i + 1}. 팀 ${row.team} — ${row.clicks}`
      t.appendChild(li)
    })
}

// UI 바인딩
el("btnSignup").addEventListener("click", signup)
el("btnStart").addEventListener("click", startGame)
el("tabDaily").addEventListener("click", () => {
  el("tabDaily").classList.add("active")
  el("tabWeekly").classList.remove("active")
  loadDaily()
})
el("tabWeekly").addEventListener("click", () => {
  el("tabWeekly").classList.add("active")
  el("tabDaily").classList.remove("active")
  loadWeekly()
})

// 자동 로그인 시도
;(async function init() {
  const uuid = localStorage.getItem("uuid")
  if (uuid) {
    try {
      const nickname = "Guest"
      const r = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname, uuid }),
      })
      const data = await r.json()
      if (data.token) {
        auth = { token: data.token, user: data.user }
        afterLogin()
      }
    } catch {}
  }
})()

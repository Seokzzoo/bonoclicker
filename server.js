/* server.js */
"use strict"

const express = require("express")
const cors = require("cors")
const dotenv = require("dotenv")
const jwt = require("jsonwebtoken")
const { nanoid } = require("nanoid")
const mysql = require("mysql2/promise")

dotenv.config()

const app = express()
app.use(express.json())
app.use(cors())
app.use("/public", express.static("public"))

// --- MySQL Pool ---
const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "clicker",
  password: process.env.DB_PASS || "fst9285xn1@",
  database: process.env.DB_NAME || "clicker",
  waitForConnections: true,
  connectionLimit: 10,
  timezone: "+09:00", // KST
})

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret"
const TEAMS = ["A", "B", "C", "D"]

// YYYY-MM-DD (KST) 얻는 헬퍼
function todayKST() {
  // en-CA 포맷은 YYYY-MM-DD 형태
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

// uuid 기반 팀 배정(결정적)
function assignTeam(uuid) {
  let sum = 0
  for (const ch of uuid) sum += ch.charCodeAt(0)
  return TEAMS[sum % 4]
}

// ---------- Auth: 최초 닉네임+UUID 등록/로그인 ----------
app.post("/api/auth/signup", async (req, res) => {
  try {
    const { nickname, uuid } = req.body
    if (!nickname || !uuid) {
      return res.status(400).json({ error: "nickname and uuid required" })
    }

    const [rows] = await pool.query("SELECT id, uuid, nickname, team FROM users WHERE uuid=?", [uuid])

    let user
    if (rows.length) {
      user = rows[0]
      // 닉네임을 바꾸고 싶다면 아래 주석을 사용:
      // await pool.query('UPDATE users SET nickname=? WHERE id=?', [nickname, user.id]);
      // user.nickname = nickname;
    } else {
      const team = assignTeam(uuid)
      const [r] = await pool.query("INSERT INTO users (uuid, nickname, team) VALUES (?,?,?)", [uuid, nickname, team])
      user = { id: r.insertId, uuid, nickname, team }
    }

    const token = jwt.sign({ uid: user.id, team: user.team }, JWT_SECRET, {
      expiresIn: "7d",
    })
    return res.json({ token, user })
  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: "signup_failed" })
  }
})

// ---------- 게임 시작(하루 1회 제한 체크 + 세션 토큰 발급) ----------
app.post("/api/game/start", async (req, res) => {
  try {
    const { token } = req.body
    const payload = jwt.verify(token, JWT_SECRET)
    const uid = payload.uid
    const today = todayKST()

    const [existing] = await pool.query("SELECT id FROM plays WHERE user_id=? AND play_date=?", [uid, today])
    if (existing.length) {
      return res.status(429).json({ error: "DAILY_LIMIT" })
    }

    const sessionId = nanoid()
    // 5분 유효 세션 토큰
    const sessionToken = jwt.sign({ sid: sessionId, uid, exp: Math.floor(Date.now() / 1000) + 60 * 5 }, JWT_SECRET)

    return res.json({ sessionId, sessionToken, windowSec: 10 })
  } catch (e) {
    console.error(e)
    return res.status(401).json({ error: "unauthorized" })
  }
})

// ---------- 결과 제출(안티치트 + 저장 + 집계) ----------
app.post("/api/game/submit", async (req, res) => {
  try {
    const { token, sessionToken, clicks, durationMs } = req.body
    const { uid, team } = jwt.verify(token, JWT_SECRET)
    const { sid } = jwt.verify(sessionToken, JWT_SECRET)

    const today = todayKST()

    // 안티치트: 10초±2초, CPS<=20
    const MAX_CPS = 20
    const valid = Number.isFinite(clicks) && Number.isFinite(durationMs) && durationMs >= 9000 && durationMs <= 12000 && clicks >= 0 && clicks <= MAX_CPS * 10

    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()

      // 하루 1회 보장
      const [exist] = await conn.query("SELECT id FROM plays WHERE user_id=? AND play_date=? FOR UPDATE", [uid, today])
      if (exist.length) {
        await conn.rollback()
        return res.status(409).json({ error: "ALREADY_SUBMITTED" })
      }

      await conn.query("INSERT INTO plays (user_id, play_date, session_id, duration_ms, clicks, valid) VALUES (?,?,?,?,?,?)", [uid, today, sid, durationMs, clicks, valid ? 1 : 0])

      // 팀 합산(유효 기록만 더함)
      await conn.query("INSERT INTO team_daily (team, day, clicks) VALUES (?,?,?) ON DUPLICATE KEY UPDATE clicks = clicks + VALUES(clicks)", [team, today, valid ? clicks : 0])

      // 개인 일간 스냅샷(마지막 기록으로 덮어씀)
      await conn.query("INSERT INTO user_daily (user_id, day, clicks) VALUES (?,?,?) ON DUPLICATE KEY UPDATE clicks = VALUES(clicks)", [uid, today, valid ? clicks : 0])

      await conn.commit()
      return res.json({ ok: true, valid })
    } catch (txe) {
      await conn.rollback()
      throw txe
    } finally {
      conn.release()
    }
  } catch (e) {
    console.error(e)
    return res.status(400).json({ error: "submit_failed" })
  }
})

// ---------- 리더보드(일간) ----------
app.get("/api/leaderboard/daily", async (req, res) => {
  const day = req.query.day || todayKST()
  try {
    const [users] = await pool.query(
      `SELECT u.nickname, u.team, ud.clicks
       FROM user_daily ud
       JOIN users u ON ud.user_id = u.id
       WHERE ud.day = ?
       ORDER BY ud.clicks DESC
       LIMIT 20`,
      [day]
    )

    const [teams] = await pool.query(
      `SELECT team, clicks
       FROM team_daily
       WHERE day = ?`,
      [day]
    )

    return res.json({ users, teams })
  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: "lb_failed" })
  }
})

// ---------- 리더보드(주간) ----------
app.get("/api/leaderboard/weekly", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.nickname, u.team, SUM(p.clicks) AS clicks
       FROM plays p
       JOIN users u ON p.user_id = u.id
       WHERE p.valid = 1
         AND YEARWEEK(p.play_date, 1) = YEARWEEK(CURDATE(), 1)
       GROUP BY p.user_id
       ORDER BY clicks DESC
       LIMIT 20`
    )

    const [teams] = await pool.query(
      `SELECT u.team, SUM(p.clicks) AS clicks
       FROM plays p
       JOIN users u ON p.user_id = u.id
       WHERE p.valid = 1
         AND YEARWEEK(p.play_date, 1) = YEARWEEK(CURDATE(), 1)
       GROUP BY u.team
       ORDER BY clicks DESC`
    )

    return res.json({ users: rows, teams })
  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: "lb_failed" })
  }
})

// ---------- 서버 시작 ----------
const PORT = Number(process.env.PORT) || 5173
app.listen(PORT, () => {
  console.log("API on", PORT)
})

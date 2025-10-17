CREATE DATABASE IF NOT EXISTS clicker DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE clicker;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  uuid CHAR(21) NOT NULL UNIQUE,
  nickname VARCHAR(32) NOT NULL,
  team ENUM('A','B','C','D') NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS plays (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  play_date DATE NOT NULL,
  session_id CHAR(21) NOT NULL,
  duration_ms INT NOT NULL,
  clicks INT NOT NULL,
  valid TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_date (user_id, play_date),
  KEY idx_session (session_id),
  CONSTRAINT fk_plays_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS team_daily (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  team ENUM('A','B','C','D') NOT NULL,
  day DATE NOT NULL,
  clicks INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_team_day (team, day)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_daily (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  day DATE NOT NULL,
  clicks INT NOT NULL,
  UNIQUE KEY uq_user_day (user_id, day),
  CONSTRAINT fk_ud_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE OR REPLACE VIEW v_user_weekly AS
SELECT p.user_id,
       STR_TO_DATE(CONCAT(YEARWEEK(p.play_date, 1),' Monday'), '%X%V %W') AS week_start,
       SUM(p.clicks) AS clicks
FROM plays p
WHERE p.valid = 1
GROUP BY p.user_id, week_start;

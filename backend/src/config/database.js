const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function initialize() {
  const connection = await pool.getConnection();
  try {
    // Create users table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        hashed_password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create notes table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS notes (
        note_id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        bg_image VARCHAR(255),
        is_checklist BOOLEAN DEFAULT FALSE,
        checklists TEXT,
        title VARCHAR(255),
        content TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        image VARCHAR(255),
        is_trashed BOOLEAN DEFAULT FALSE,
        is_archived BOOLEAN DEFAULT FALSE,
        is_pinned BOOLEAN DEFAULT FALSE,
        labels TEXT,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL
      );
    `);

    // Create labels table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS labels (
        label_id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        note_id INT,
        label VARCHAR(100),
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
        FOREIGN KEY (note_id) REFERENCES notes(note_id) ON DELETE CASCADE
      );
    `);

    // Create shared table for note collaboration
    await connection.query(`
      CREATE TABLE IF NOT EXISTS shared (
        id INT AUTO_INCREMENT PRIMARY KEY,
        note_id INT,
        user_id INT,
        FOREIGN KEY (note_id) REFERENCES notes(note_id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      );
    `);

    console.log("Database initialized successfully.");
  } catch (err) {
    console.error("Error initializing database:", err);
    throw err;
  } finally {
    connection.release();
  }
}

module.exports = { pool, initialize };

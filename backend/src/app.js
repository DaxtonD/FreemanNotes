const express = require('express');
const dotenv = require('dotenv');
const db = require('./config/database');
const bcrypt = require('bcryptjs');
const cors = require('cors');

dotenv.config();

const app = express();

// Enable CORS so the Angular app can communicate with the backend
app.use(cors());
app.use(express.json());

// Test route
app.get('/', (req, res) => {
  res.send('Welcome to FreemanNotes API');
});

// Registration endpoint
app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }
    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const connection = await db.pool.getConnection();
    await connection.query(
      'INSERT INTO users (email, hashed_password) VALUES (?, ?)',
      [email, hashedPassword]
    );
    connection.release();
    
    return res.status(201).json({ message: 'User registered successfully' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error registering user' });
  }
});

// Login endpoint
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }
    const connection = await db.pool.getConnection();
    const [rows] = await connection.query('SELECT * FROM users WHERE email = ?', [email]);
    connection.release();

    if (rows.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    const user = rows[0];
    const passwordMatch = await bcrypt.compare(password, user.hashed_password);
    if (!passwordMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    // For now, return a dummy token
    return res.json({ token: 'dummy-token', message: 'Login successful' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error during login' });
  }
});

// Initialize the database and start the server
db.initialize()
  .then(() => {
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });

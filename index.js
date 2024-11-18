const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config();

const app = express();

// MongoDB connection with environment variable
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/mailingList';
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// Subscriber Schema
const subscriberSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  name: {
    type: String,
    trim: true
  },
  subscribeDate: {
    type: Date,
    default: Date.now
  },
  active: {
    type: Boolean,
    default: true
  }
});

const Subscriber = mongoose.model('Subscriber', subscriberSchema);

// Middleware
app.use(cors()); 
app.use(bodyParser.json());
app.use(express.static('public'));

// Basic auth middleware
const basicAuth = (req, res, next) => {
  const auth = req.headers.authorization;
  
  if (!auth || !auth.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Access"');
    return res.status(401).json({ message: 'Authentication required' });
  }

  const credentials = Buffer.from(auth.split(' ')[1], 'base64').toString().split(':');
  const username = credentials[0];
  const password = credentials[1];

  // Replace these with your desired admin credentials
  if (username === 'admin' && password === 'euterpe2024') {
    next();
  } else {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Access"');
    return res.status(401).json({ message: 'Invalid credentials' });
  }
};

// Existing routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.post('/subscribe', async (req, res) => {
  try {
    const { email, name } = req.body;
    const subscriber = new Subscriber({ email, name });
    await subscriber.save();
    res.status(201).json({ message: 'Successfully subscribed!' });
  } catch (error) {
    if (error.code === 11000) {
      res.status(400).json({ message: 'Email already subscribed' });
    } else {
      console.error('Subscription error:', error);
      res.status(500).json({ message: 'Server error' });
    }
  }
});

// Admin routes
app.get('/admin', basicAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin.html'));
});

app.get('/api/subscribers', basicAuth, async (req, res) => {
  try {
    const subscribers = await Subscriber.find()
      .sort({ subscribeDate: -1 }) // Sort by date, newest first
      .select('-__v'); // Exclude version field
    res.json(subscribers);
  } catch (error) {
    console.error('Error fetching subscribers:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete subscriber
app.delete('/api/subscribers/:id', basicAuth, async (req, res) => {
  try {
    await Subscriber.findByIdAndDelete(req.params.id);
    res.json({ message: 'Subscriber deleted successfully' });
  } catch (error) {
    console.error('Error deleting subscriber:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
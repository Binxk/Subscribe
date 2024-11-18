```javascript
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
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

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```
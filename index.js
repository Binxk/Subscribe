const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();

// Email transporter setup for Namecheap Private Email
const transporter = nodemailer.createTransport({
    host: 'mail.privateemail.com',
    port: 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    },
    tls: {
        rejectUnauthorized: true
    }
});

// Verify email configuration on startup
transporter.verify()
    .then(() => console.log('Email server configuration verified'))
    .catch(error => console.error('Email verification failed:', error));

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI;
mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// Email template function
const createWelcomeEmail = (name) => {
    return {
        subject: 'Welcome to Euterpe\'s Mailing List!',
        text: `Hi ${name},\n\nThank you for subscribing to our mailing list! We're excited to keep you updated about our latest news and upcoming gigs.\n\nBest regards,\nEuterpe Team`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2>Welcome to Euterpe's Mailing List!</h2>
                <p>Hi ${name},</p>
                <p>Thank you for subscribing to our mailing list! We're excited to keep you updated about our latest news and upcoming gigs.</p>
                <p>Best regards,<br>Euterpe Team</p>
            </div>
        `
    };
};

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
    
    if (username === 'admin' && password === 'euterpe2024') {
        next();
    } else {
        res.setHeader('WWW-Authenticate', 'Basic realm="Admin Access"');
        return res.status(401).json({ message: 'Invalid credentials' });
    }
};

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Subscribe route with email confirmation
app.post('/subscribe', async (req, res) => {
    try {
        const { email, name } = req.body;

        // Input validation
        if (!email || !name) {
            return res.status(400).json({ message: 'Email and name are required' });
        }

        // Create new subscriber
        const subscriber = new Subscriber({ email, name });
        await subscriber.save();

        // Send welcome email
        const emailContent = createWelcomeEmail(name);
        await transporter.sendMail({
            from: `"Euterpe" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: emailContent.subject,
            text: emailContent.text,
            html: emailContent.html
        });

        res.status(201).json({ 
            message: 'Successfully subscribed! Check your email for confirmation.' 
        });
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

// Get all subscribers
app.get('/api/subscribers', basicAuth, async (req, res) => {
    try {
        const subscribers = await Subscriber.find()
            .sort({ subscribeDate: -1 })
            .select('-__v');
        res.json(subscribers);
    } catch (error) {
        console.error('Error fetching subscribers:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete subscriber
app.delete('/api/subscribers/:id', basicAuth, async (req, res) => {
    try {
        const result = await Subscriber.findByIdAndDelete(req.params.id);
        if (!result) {
            return res.status(404).json({ message: 'Subscriber not found' });
        }
        res.json({ message: 'Subscriber deleted successfully' });
    } catch (error) {
        console.error('Error deleting subscriber:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Send newsletter
app.post('/api/send-newsletter', basicAuth, async (req, res) => {
    try {
        const { subject, content } = req.body;
        
        if (!subject || !content) {
            return res.status(400).json({ 
                message: 'Subject and content are required' 
            });
        }

        const subscribers = await Subscriber.find({ active: true });
        
        const emailPromises = subscribers.map(subscriber => {
            return transporter.sendMail({
                from: `"Euterpe" <${process.env.EMAIL_USER}>`,
                to: subscriber.email,
                subject: subject,
                html: content
            });
        });

        await Promise.all(emailPromises);
        res.json({ 
            message: 'Newsletter sent successfully',
            recipientCount: subscribers.length
        });
    } catch (error) {
        console.error('Error sending newsletter:', error);
        res.status(500).json({ 
            message: 'Error sending newsletter',
            error: error.message
        });
    }
});

// Email configuration test route
app.get('/test-email', basicAuth, async (req, res) => {
    try {
        await transporter.sendMail({
            from: `"Euterpe Band" <${process.env.EMAIL_USER}>`,
            to: process.env.EMAIL_USER,
            subject: "Email Configuration Test",
            text: "If you receive this email, your email configuration is working correctly!"
        });
        res.json({ message: 'Test email sent successfully' });
    } catch (error) {
        console.error('Email test error:', error);
        res.status(500).json({ 
            message: 'Email test failed', 
            error: error.message 
        });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ 
        message: 'Something went wrong!',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
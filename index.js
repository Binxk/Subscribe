const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
require('dotenv').config();

const app = express();

// Helper function to get base URL
const getBaseUrl = () => {
    // Check for environment variables in order of preference
    return process.env.SITE_URL || 
           process.env.RENDER_EXTERNAL_URL || 
           `http://localhost:${process.env.PORT || 10000}`;
};

// Helper function to generate unsubscribe token
const generateUnsubscribeToken = (email) => {
    return crypto
        .createHash('sha256')
        .update(email + (process.env.EMAIL_SECRET || 'default-secret-key'))
        .digest('hex');
};

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

// Email template function with unsubscribe link
const createWelcomeEmail = (name, email) => {
    const unsubscribeToken = generateUnsubscribeToken(email);
    const baseUrl = getBaseUrl();
    const unsubscribeUrl = `${baseUrl}/unsubscribe?email=${encodeURIComponent(email)}&token=${unsubscribeToken}`;
    
    return {
        subject: 'Welcome to Euterpe\'s Mailing email spam!',
        text: `Hi ${name},\n\nthank you for letting us send you spam emails about gigs, merch drops, music releases and more.\n\nmost sincere regards,\nEuterpe\n\nTo unsubscribe, visit: ${unsubscribeUrl}`,
        html: `
            <div style="font-family: 'Times New Roman', Times, serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #333;">Welcome to euterpe email spam</h2>
                <p>Hi ${name},</p>
                <p>thank you for letting us send you spam emails about gigs, merch drops, music releases and more.</p>
                <p>most sincere regards,<br>Euterpe</p>
                <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee;">
                    <p style="font-size: 12px; color: #666;">
                        Don't want to receive these emails? 
                        <a href="${unsubscribeUrl}" style="color: #333;">Unsubscribe here</a>
                    </p>
                </div>
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

// Middleware setup - IMPORTANT: Order matters!
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

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

        if (!email || !name) {
            return res.status(400).json({ message: 'Email and name are required' });
        }

        const subscriber = new Subscriber({ email, name });
        await subscriber.save();

        const emailContent = createWelcomeEmail(name, email);
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

// Send newsletter with unsubscribe link
app.post('/api/send-newsletter', basicAuth, async (req, res) => {
    try {
        const { subject, content } = req.body;
        
        if (!subject || !content) {
            return res.status(400).json({ message: 'Subject and content are required' });
        }

        const subscribers = await Subscriber.find({ active: true });
        const baseUrl = getBaseUrl();
        
        const emailPromises = subscribers.map(subscriber => {
            const unsubscribeToken = generateUnsubscribeToken(subscriber.email);
            const unsubscribeUrl = `${baseUrl}/unsubscribe?email=${encodeURIComponent(subscriber.email)}&token=${unsubscribeToken}`;
            
            const emailContent = `
                ${content}
                <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee;">
                    <p style="font-size: 12px; color: #666;">
                        Don't want to receive these emails? 
                        <a href="${unsubscribeUrl}" style="color: #333;">Unsubscribe here</a>
                    </p>
                </div>
            `;

            return transporter.sendMail({
                from: `"Euterpe" <${process.env.EMAIL_USER}>`,
                to: subscriber.email,
                subject: subject,
                html: emailContent
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

// Unsubscribe page route
// Replace your current unsubscribe route with this:
app.get('/unsubscribe', (req, res) => {
    console.log('Unsubscribe request received');
    const { email, token } = req.query;
    
    // Send HTML directly instead of trying to serve a file
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Unsubscribe - Euterpe</title>
    <style>
        body {
            font-family: 'Times New Roman', Times, serif;
            margin: 0;
            padding: 0;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            background-color: #ffffff;
        }
        .container {
            max-width: 600px;
            width: 90%;
            margin: 2rem auto;
            padding: 2rem;
            text-align: center;
            border: 1px solid #000000;
        }
        h1 {
            font-size: 2.5rem;
            margin-bottom: 2rem;
            color: #000000;
        }
        .message {
            font-size: 1.2rem;
            margin-bottom: 2rem;
            line-height: 1.6;
            color: #333;
        }
        #status {
            padding: 1rem;
            margin-top: 1rem;
            border: 1px solid #000000;
            display: none;
        }
        .success {
            background-color: #ffffff;
            color: #000000;
        }
        .error {
            background-color: #ffffff;
            color: #000000;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Unsubscribe from Euterpe's Mailing List</h1>
        <div class="message">Please wait while we process your request...</div>
        <div id="status"></div>
    </div>
    <script>
        document.addEventListener('DOMContentLoaded', async () => {
            const email = "${email}";
            const token = "${token}";
            
            if (!email || !token) {
                showError('Invalid unsubscribe link');
                return;
            }
            
            try {
                const response = await fetch('/api/unsubscribe?email=' + encodeURIComponent(email) + '&token=' + encodeURIComponent(token));
                const data = await response.json();
                
                if (response.ok) {
                    showSuccess(data.message);
                } else {
                    showError(data.message);
                }
            } catch (error) {
                console.error('Error:', error);
                showError('An error occurred while processing your request');
            }
        });

        function showSuccess(message) {
            const messageDiv = document.querySelector('.message');
            const statusDiv = document.getElementById('status');
            messageDiv.textContent = message || 'You have been successfully unsubscribed.';
            statusDiv.className = 'success';
            statusDiv.style.display = 'block';
        }

        function showError(message) {
            const messageDiv = document.querySelector('.message');
            const statusDiv = document.getElementById('status');
            messageDiv.textContent = message || 'An error occurred.';
            statusDiv.className = 'error';
            statusDiv.style.display = 'block';
        }
    </script>
</body>
</html>
    `);
});



// API endpoint for handling unsubscribe requests
app.get('/api/unsubscribe', async (req, res) => {
    try {
        const { email, token } = req.query;
        
        if (!email || !token) {
            return res.status(400).json({ message: 'Invalid unsubscribe link' });
        }

        // Verify token
        const expectedToken = generateUnsubscribeToken(email);
        if (token !== expectedToken) {
            return res.status(400).json({ message: 'Invalid unsubscribe link' });
        }

        // Update subscriber status
        const subscriber = await Subscriber.findOne({ email });
        if (!subscriber) {
            return res.status(404).json({ message: 'Subscriber not found' });
        }

        subscriber.active = false;
        await subscriber.save();

        res.json({ message: 'You have been successfully unsubscribed from Euterpe\'s mailing list.' });
    } catch (error) {
        console.error('Unsubscribe error:', error);
        res.status(500).json({ message: 'Error processing unsubscribe request' });
    }
});

// Email configuration test route
app.get('/test-email', basicAuth, async (req, res) => {
    try {
        const testEmailContent = createWelcomeEmail('Test User', process.env.EMAIL_USER);
        await transporter.sendMail({
            from: `"Euterpe Band" <${process.env.EMAIL_USER}>`,
            to: process.env.EMAIL_USER,
            subject: testEmailContent.subject,
            text: testEmailContent.text,
            html: testEmailContent.html
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

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
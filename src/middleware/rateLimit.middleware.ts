import Bottleneck from 'bottleneck';
import { Request, Response, NextFunction } from 'express';

// Create a Bottleneck instance for throttling
const limiter = new Bottleneck({
    maxConcurrent: 1, // Allow only 1 concurrent request per user
    minTime: 500, // Minimum 500ms between requests
});

// Middleware to throttle requests
export function rateLimit(req: Request, res: Response, next: NextFunction): void {
    const userId = req.user?.id; // Assuming user is authenticated and user ID is available

    if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    // Schedule the request in the limiter
    limiter.schedule(() => Promise.resolve()).then(() => {
        next();
    }).catch(() => {
        res.status(429).json({ message: 'Too many requests, please try again later.' });
    });
}
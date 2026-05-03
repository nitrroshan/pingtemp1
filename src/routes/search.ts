import { Router } from 'express';
import { Request, Response } from 'express';
import { pool } from '../db';

const router = Router();

/**
 * GET /search
 * Search notes by title or content using full-text search.
 */
router.get('/search', async (req: Request, res: Response) => {
    const { query, page = '1', limit = '10' } = req.query;

    // Validate query parameter
    if (!query || typeof query !== 'string') {
        return res.status(400).json({ error: 'Query parameter is required and must be a string.' });
    }

    const pageNumber = parseInt(page as string, 10);
    const pageSize = parseInt(limit as string, 10);

    if (isNaN(pageNumber) || pageNumber < 1 || isNaN(pageSize) || pageSize < 1) {
        return res.status(400).json({ error: 'Page and limit must be positive integers.' });
    }

    const offset = (pageNumber - 1) * pageSize;

    try {
        // Search query using full-text search index
        const searchQuery = `to_tsquery($1)`;
        const sql = `
            SELECT id, title, content, user_id, created_at, updated_at
            FROM notes
            WHERE to_tsvector('english', title || ' ' || content) @@ ${searchQuery}
            ORDER BY ts_rank(to_tsvector('english', title || ' ' || content), ${searchQuery}) DESC
            LIMIT $2 OFFSET $3;
        `;

        const { rows } = await pool.query(sql, [query, pageSize, offset]);

        res.json({
            data: rows,
            pagination: {
                page: pageNumber,
                limit: pageSize,
                count: rows.length,
            },
        });
    } catch (error) {
        console.error('Error executing search:', error);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

export default router;
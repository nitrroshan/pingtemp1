import mongoose, { Schema, Document } from 'mongoose';

export interface Note extends Document {
    title: string;
    content: string;
    user: mongoose.Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const NoteSchema: Schema = new Schema(
    {
        title: { type: String, required: true, index: true }, // Indexed for search optimization
        content: { type: String, required: true },
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // User association
    },
    {
        timestamps: true, // Automatically adds createdAt and updatedAt
    }
);

// Compound index for title and content search
NoteSchema.index({ title: 'text', content: 'text' });

export const NoteModel = mongoose.model<Note>('Note', NoteSchema);
import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { FilePicker } from '../components/FilePicker';

describe('FilePicker', () => {
    it('renders empty state', () => {
        const onFileSelect = vi.fn();
        render(<FilePicker file={null} onFileSelect={onFileSelect} />);
        expect(screen.getByText(/Drop PDF here or click to browse/i)).toBeInTheDocument();
    });

    it('renders selected file name', () => {
        const onFileSelect = vi.fn();
        const file = new File([''], 'lecture.pdf', { type: 'application/pdf' });
        render(<FilePicker file={file} onFileSelect={onFileSelect} />);
        expect(screen.getByText('lecture.pdf')).toBeInTheDocument();
    });

    it('handles file selection via input', () => {
        const onFileSelect = vi.fn();
        const { container } = render(<FilePicker file={null} onFileSelect={onFileSelect} />);

        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        const file = new File([''], 'new.pdf', { type: 'application/pdf' });

        fireEvent.change(input, { target: { files: [file] } });
        expect(onFileSelect).toHaveBeenCalledWith(file);
    });

    it('clears file when clicking remove button', () => {
        const onFileSelect = vi.fn();
        const file = new File([''], 'lecture.pdf', { type: 'application/pdf' });
        const { container } = render(<FilePicker file={file} onFileSelect={onFileSelect} />);

        const removeBtn = container.querySelector('button');
        if (removeBtn) {
            fireEvent.click(removeBtn);
            expect(onFileSelect).toHaveBeenCalledWith(null);
        }
    });
});

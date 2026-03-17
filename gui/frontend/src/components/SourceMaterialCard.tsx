import { FilePicker } from './FilePicker';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SourceMaterialCardProps {
    file: File | null;
    onFileSelect: (file: File | null) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SourceMaterialCard({ file, onFileSelect }: SourceMaterialCardProps) {
    return (
        <div className="space-y-4">
            <h2 className="text-2xl font-bold tracking-tight text-text-main">Source Material</h2>
            <FilePicker file={file} onFileSelect={onFileSelect} />
        </div>
    );
}

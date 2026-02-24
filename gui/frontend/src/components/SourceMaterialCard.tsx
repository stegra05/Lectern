
import { clsx } from 'clsx';
import { GlassCard } from './GlassCard';
import { FilePicker } from './FilePicker';
import { useLecternStore } from '../store';

export function SourceMaterialCard() {
    const pdfFile = useLecternStore((s) => s.pdfFile);
    const setPdfFile = useLecternStore((s) => s.setPdfFile);

    return (
        <GlassCard className="space-y-6">
            <div className="flex items-center gap-3">
                <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-surface text-text-muted font-mono text-sm">01</span>
                <h2 className="text-xl font-semibold">Source Material</h2>
            </div>
            <FilePicker file={pdfFile} onFileSelect={setPdfFile} />
        </GlassCard>
    );
}

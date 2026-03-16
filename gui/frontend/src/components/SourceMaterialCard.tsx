
import { FilePicker } from './FilePicker';
import { useLecternStore } from '../store';

export function SourceMaterialCard() {
    const pdfFile = useLecternStore((s) => s.pdfFile);
    const setPdfFile = useLecternStore((s) => s.setPdfFile);

    return (
        <div className="space-y-4">
            <h2 className="text-2xl font-bold tracking-tight text-text-main">Source Material</h2>
            <FilePicker file={pdfFile} onFileSelect={setPdfFile} />
        </div>
    );
}


import { useRef, useState } from 'react';
import { Upload, FileText, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';

interface FilePickerProps {
    file: File | null;
    onFileSelect: (file: File | null) => void;
}

export function FilePicker({ file, onFileSelect }: FilePickerProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [isDragging, setIsDragging] = useState(false);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            const droppedFile = e.dataTransfer.files[0];
            if (droppedFile.type === 'application/pdf') {
                onFileSelect(droppedFile);
            }
        }
    };

    return (
        <div className="w-full">
            <input
                type="file"
                ref={inputRef}
                onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                        onFileSelect(e.target.files[0]);
                    }
                }}
                accept=".pdf"
                className="hidden"
            />

            <AnimatePresence mode="wait">
                {!file ? (
                    <motion.div
                        key="empty"
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        onClick={() => inputRef.current?.click()}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        className={clsx(
                            "relative group cursor-pointer border-2 border-dashed rounded-xl p-8 transition-all duration-300",
                            isDragging
                                ? "border-primary bg-primary/5"
                                : "border-zinc-700 hover:border-zinc-500 hover:bg-zinc-800/50"
                        )}
                    >
                        <div className="flex flex-col items-center justify-center gap-4 text-center">
                            <div className={clsx(
                                "p-4 rounded-full transition-colors duration-300",
                                isDragging ? "bg-primary/20 text-primary" : "bg-zinc-800 text-zinc-400 group-hover:text-zinc-200"
                            )}>
                                <Upload className="w-8 h-8" />
                            </div>
                            <div>
                                <p className="text-lg font-medium text-zinc-200">
                                    Drop PDF here or click to browse
                                </p>
                                <p className="text-sm text-zinc-500 mt-1">
                                    Supports .pdf files up to 50MB
                                </p>
                            </div>
                        </div>
                    </motion.div>
                ) : (
                    <motion.div
                        key="selected"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="relative bg-zinc-800/50 border border-zinc-700 rounded-xl p-4 flex items-center gap-4 group"
                    >
                        <div className="p-3 bg-red-500/10 rounded-lg">
                            <FileText className="w-6 h-6 text-red-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="font-medium text-zinc-200 truncate">
                                {file.name}
                            </p>
                            <p className="text-xs text-zinc-500">
                                {(file.size / 1024 / 1024).toFixed(2)} MB
                            </p>
                        </div>
                        <button
                            onClick={() => onFileSelect(null)}
                            className="p-2 hover:bg-zinc-700 rounded-lg text-zinc-500 hover:text-zinc-300 transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

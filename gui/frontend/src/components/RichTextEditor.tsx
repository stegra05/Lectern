import React, { useEffect, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { clsx } from 'clsx';
import DOMPurify from 'dompurify';

export interface RichTextEditorProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
    onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
}

export const RichTextEditor: React.FC<RichTextEditorProps> = ({
    value,
    onChange,
    placeholder = 'Type here...',
    disabled = false,
    className,
    onKeyDown,
}) => {
    // Keep track of internal content to avoid formatting loop/jumping cursor
    const [internalValue, setInternalValue] = useState(value);

    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: false, // We usually don't need heavy headings for flashcards
                codeBlock: false,
                blockquote: false,
                horizontalRule: false,
            }),
            Placeholder.configure({
                placeholder,
            }),
        ],
        content: value,
        editable: !disabled,
        onUpdate: ({ editor }) => {
            const html = editor.getHTML();
            // Tiptap might return '<p></p>' for empty content, we can normalize it if we want.
            const cleanHtml = html === '<p></p>' ? '' : html;
            setInternalValue(cleanHtml);
            onChange(cleanHtml);
        },
        editorProps: {
            attributes: {
                class: clsx(
                    "prose prose-sm prose-invert max-w-none",
                    "focus:outline-none min-h-[100px]"
                ),
            },
        },
    });

    // Sync external value changes (e.g. when switching cards) - using render-time check to avoid cascading renders
    const [prevValue, setPrevValue] = useState(value);
    if (value !== prevValue) {
        setPrevValue(value);
        if (value !== internalValue) {
            const sanitized = DOMPurify.sanitize(value);
            editor?.commands.setContent(sanitized, { emitUpdate: false });
            setInternalValue(sanitized);
        }
    }

    useEffect(() => {
        if (editor) {
            editor.setEditable(!disabled);
        }
    }, [editor, disabled]);

    return (
        <div
            className={clsx(
                "w-full bg-background border border-border rounded-lg p-3",
                "text-sm text-text-main leading-relaxed",
                "focus-within:ring-1 focus-within:ring-primary/50 focus-within:border-primary/50 transition-all",
                disabled && "opacity-50 cursor-not-allowed",
                className
            )}
            onClick={() => {
                if (!disabled && editor) {
                    editor.commands.focus();
                }
            }}
            onKeyDown={onKeyDown}
        >
            <EditorContent editor={editor} disabled={disabled} />
        </div>
    );
};

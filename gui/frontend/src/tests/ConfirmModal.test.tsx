import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfirmModal } from '../components/ConfirmModal';

// Mock framer-motion to avoid animation issues in tests
vi.mock('framer-motion', () => ({
    motion: {
        div: ({ children, onClick, className }: { children: React.ReactNode; onClick?: () => void; className?: string }) => (
            <div onClick={onClick} className={className} data-testid="motion-div">
                {children}
            </div>
        ),
    },
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock useFocusTrap hook
vi.mock('../hooks/useFocusTrap', () => ({
    useFocusTrap: vi.fn(),
}));

const mockOnClose = vi.fn();
const mockOnConfirm = vi.fn();

const defaultProps = {
    isOpen: true,
    onClose: mockOnClose,
    onConfirm: mockOnConfirm,
    title: 'Confirm Action',
    description: 'Are you sure you want to proceed?',
};

describe('ConfirmModal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Render conditions', () => {
        it('does not render when isOpen is false', () => {
            render(<ConfirmModal {...defaultProps} isOpen={false} />);

            expect(screen.queryByText('Confirm Action')).not.toBeInTheDocument();
        });

        it('renders when isOpen is true', () => {
            render(<ConfirmModal {...defaultProps} />);

            expect(screen.getByText('Confirm Action')).toBeInTheDocument();
            expect(screen.getByText('Are you sure you want to proceed?')).toBeInTheDocument();
        });
    });

    describe('Content display', () => {
        it('displays title and description', () => {
            render(
                <ConfirmModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onConfirm={mockOnConfirm}
                    title="Delete Item"
                    description="This action cannot be undone."
                />
            );

            expect(screen.getByText('Delete Item')).toBeInTheDocument();
            expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument();
        });

        it('displays custom confirm and cancel text', () => {
            render(
                <ConfirmModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onConfirm={mockOnConfirm}
                    title="Test"
                    description="Test"
                    confirmText="Yes, Delete"
                    cancelText="No, Keep"
                />
            );

            expect(screen.getByText('Yes, Delete')).toBeInTheDocument();
            expect(screen.getByText('No, Keep')).toBeInTheDocument();
        });

        it('displays default confirm and cancel text when not provided', () => {
            render(<ConfirmModal {...defaultProps} />);

            expect(screen.getByText('Confirm')).toBeInTheDocument();
            expect(screen.getByText('Cancel')).toBeInTheDocument();
        });

        it('supports React nodes as description', () => {
            render(
                <ConfirmModal
                    isOpen={true}
                    onClose={mockOnClose}
                    onConfirm={mockOnConfirm}
                    title="Test"
                    description={
                        <span>
                            This is <strong>bold</strong> text
                        </span>
                    }
                />
            );

            expect(screen.getByText('bold')).toBeInTheDocument();
        });
    });

    describe('Button interactions', () => {
        it('calls onConfirm and onClose when confirm button is clicked', async () => {
            render(<ConfirmModal {...defaultProps} />);

            const confirmButton = screen.getByText('Confirm');
            await act(async () => {
                fireEvent.click(confirmButton);
            });

            expect(mockOnConfirm).toHaveBeenCalledTimes(1);
            expect(mockOnClose).toHaveBeenCalledTimes(1);
        });

        it('calls only onClose when cancel button is clicked', async () => {
            render(<ConfirmModal {...defaultProps} />);

            const cancelButton = screen.getByText('Cancel');
            await act(async () => {
                fireEvent.click(cancelButton);
            });

            expect(mockOnConfirm).not.toHaveBeenCalled();
            expect(mockOnClose).toHaveBeenCalledTimes(1);
        });

        it('calls onClose when close (X) button is clicked', async () => {
            render(<ConfirmModal {...defaultProps} />);

            const closeButton = screen.getByLabelText('Close confirmation dialog');
            await act(async () => {
                fireEvent.click(closeButton);
            });

            expect(mockOnClose).toHaveBeenCalledTimes(1);
            expect(mockOnConfirm).not.toHaveBeenCalled();
        });

        it('calls onClose when backdrop is clicked', async () => {
            render(<ConfirmModal {...defaultProps} />);

            // The backdrop is the first motion-div
            const backdrop = screen.getAllByTestId('motion-div')[0];
            await act(async () => {
                fireEvent.click(backdrop);
            });

            expect(mockOnClose).toHaveBeenCalledTimes(1);
        });
    });

    describe('Destructive variant', () => {
        it('applies destructive styling to confirm button', () => {
            render(
                <ConfirmModal
                    {...defaultProps}
                    variant="destructive"
                    title="Delete Item"
                />
            );

            const confirmButton = screen.getByText('Confirm');
            // Check for destructive styling classes
            expect(confirmButton.className).toContain('bg-red-500');
        });

        it('displays warning icon for destructive variant', () => {
            render(
                <ConfirmModal
                    {...defaultProps}
                    variant="destructive"
                    title="Delete Item"
                />
            );

            // The title should have red text for destructive variant
            const title = screen.getByText('Delete Item');
            expect(title.className).toContain('text-red-400');
        });

        it('applies default styling for default variant', () => {
            render(
                <ConfirmModal
                    {...defaultProps}
                    variant="default"
                />
            );

            const confirmButton = screen.getByText('Confirm');
            expect(confirmButton.className).toContain('bg-primary');
        });
    });

    describe('Accessibility', () => {
        it('has correct ARIA attributes', () => {
            render(<ConfirmModal {...defaultProps} />);

            // Check for alertdialog role
            const dialog = screen.getByRole('alertdialog');
            expect(dialog).toBeInTheDocument();
            expect(dialog).toHaveAttribute('aria-modal', 'true');
            expect(dialog).toHaveAttribute('aria-labelledby', 'confirm-title');
            expect(dialog).toHaveAttribute('aria-describedby', 'confirm-description');
        });

        it('has accessible labels for buttons', () => {
            render(
                <ConfirmModal
                    {...defaultProps}
                    confirmText="Delete"
                    cancelText="Keep"
                />
            );

            expect(screen.getByLabelText('Delete')).toBeInTheDocument();
            expect(screen.getByLabelText('Keep')).toBeInTheDocument();
        });
    });

    describe('Focus trap integration', () => {
        it('calls useFocusTrap with correct options', async () => {
            const { useFocusTrap } = await import('../hooks/useFocusTrap');
            const mockUseFocusTrap = vi.mocked(useFocusTrap);

            render(<ConfirmModal {...defaultProps} />);

            // Verify useFocusTrap was called with isActive: true and onEscape callback
            expect(mockUseFocusTrap).toHaveBeenCalledWith(
                expect.any(Object),
                expect.objectContaining({
                    isActive: true,
                    onEscape: mockOnClose,
                    autoFocus: true,
                    restoreFocus: false,
                })
            );
        });
    });

    describe('Confirm then close ordering', () => {
        it('calls onConfirm before onClose', async () => {
            const callOrder: string[] = [];
            const onConfirm = vi.fn(() => callOrder.push('confirm'));
            const onClose = vi.fn(() => callOrder.push('close'));

            render(
                <ConfirmModal
                    isOpen={true}
                    onClose={onClose}
                    onConfirm={onConfirm}
                    title="Test"
                    description="Test"
                />
            );

            const confirmButton = screen.getByText('Confirm');
            await act(async () => {
                fireEvent.click(confirmButton);
            });

            expect(callOrder).toEqual(['confirm', 'close']);
        });
    });
});

import { motion, AnimatePresence } from 'framer-motion';

export interface SyncSuccessOverlayProps {
    /** Whether the sync was successful, controls visibility */
    syncSuccess: boolean;
    /** Callback when user dismisses the overlay */
    onDismiss: () => void;
}

/**
 * SyncSuccessOverlay displays an animated success message when sync completes.
 *
 * This component is pure and relies on props for visibility.
 */
export function SyncSuccessOverlay({ syncSuccess, onDismiss }: SyncSuccessOverlayProps) {

    return (
        <AnimatePresence>
            {syncSuccess && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-md cursor-pointer"
                    onClick={onDismiss}
                >
                    <motion.div
                        initial={{ scale: 0.8, opacity: 0, y: 30 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 1.05, opacity: 0, y: -10 }}
                        transition={{ type: "spring", damping: 20, stiffness: 120, mass: 0.8 }}
                        className="flex flex-col items-center"
                    >
                        <div className="relative w-32 h-32 mb-8">
                            <motion.div
                                initial={{ scale: 0.8, opacity: 0 }}
                                animate={{ scale: 1.2, opacity: 1 }}
                                transition={{ duration: 0.8, repeat: Infinity, repeatType: "reverse" }}
                                className="absolute inset-0 bg-primary/20 rounded-full blur-2xl"
                            />
                            <svg className="w-full h-full" viewBox="0 0 100 100">
                                <motion.circle
                                    initial={{ pathLength: 0, opacity: 0 }}
                                    animate={{ pathLength: 1, opacity: 1 }}
                                    transition={{ duration: 0.8, ease: "easeInOut" }}
                                    cx="50" cy="50" r="45" fill="none" stroke="currentColor" strokeWidth="8"
                                    className="text-primary" strokeLinecap="round"
                                />
                                <motion.path
                                    initial={{ pathLength: 0, opacity: 0 }}
                                    animate={{ pathLength: 1, opacity: 1 }}
                                    transition={{ duration: 0.6, delay: 0.5, ease: "easeOut" }}
                                    d="M30 52L44 66L70 34" fill="none" stroke="currentColor" strokeWidth="8"
                                    className="text-primary" strokeLinecap="round" strokeLinejoin="round"
                                />
                            </svg>
                        </div>
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.8 }}
                            className="text-center"
                        >
                            <h2 className="text-3xl font-bold text-text-main mb-2 tracking-tight">Sync Complete!</h2>
                            <p className="text-text-muted font-medium">Your collection is now up to date.</p>
                        </motion.div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

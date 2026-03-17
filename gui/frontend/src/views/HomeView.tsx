import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { SourceMaterialCard } from '../components/SourceMaterialCard';
import { ConfigurationCard, type EstimationDisplay, type SliderConfig } from '../components/ConfigurationCard';
import { GenerationSummaryCard, type ValidationState } from '../components/GenerationSummaryCard';
import type { DeckSelectorProps } from '../components/DeckSelector';
import type { HealthStatus } from '../hooks/useAppState';
import { useEstimationLogic } from '../hooks/useEstimationLogic';
import { useEstimationPhase } from '../hooks/useEstimationPhase';
import { computeTargetSliderConfig } from '../utils/density';
import { translateError } from '../utils/errorMessages';
import {
    useSourceState,
    useConfigurationState,
    useEstimationState,
    useDeckState,
    useGenerationValidation,
    useHomeActions,
    useSummaryInfo,
    useCostDisplay,
} from '../hooks/useLecternSelectors';
import { useDecksQuery, useCreateDeckMutation } from '../queries';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COST_WARNING_THRESHOLD = 0.50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HomeViewProps {
    handleGenerate: () => void;
    health: HealthStatus | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HomeView({ handleGenerate, health }: HomeViewProps) {
    // Run estimation side effects (this hook manages the estimation API calls)
    useEstimationLogic(health);

    // Atomic selectors for state
    const sourceState = useSourceState();
    const configState = useConfigurationState();
    const estimationState = useEstimationState();
    const deckState = useDeckState();
    const validation = useGenerationValidation();

    // Derived state via memoized selectors
    const summaryInfo = useSummaryInfo();
    const costDisplay = useCostDisplay();
    // Actions
    const actions = useHomeActions();

    // Estimation phase (for animated progress indicator)
    const estimationPhase = useEstimationPhase(estimationState.isEstimating);

    // Deck selector state (managed here, not in component)
    const [isDeckOpen, setIsDeckOpen] = useState(false);
    const [deckSearchQuery, setDeckSearchQuery] = useState('');
    const [expandedDeckNodes, setExpandedDeckNodes] = useState<Set<string>>(new Set());
    const matchedDeckNodesRef = useRef<Set<string>>(new Set());

    // Cost warning state
    const [attemptedSubmit, setAttemptedSubmit] = useState(false);
    const [showCostWarning, setShowCostWarning] = useState(false);
    const [costWarningDismissed, setCostWarningDismissed] = useState(false);

    // React Query for decks
    const { data: decksResponse, isLoading: isLoadingDecks } = useDecksQuery();
    const createDeckMutation = useCreateDeckMutation();

    // Derived available decks from React Query
    const availableDecks = useMemo(() => decksResponse?.decks || [], [decksResponse]);

    // Reset warning dismissal when estimation changes
    useEffect(() => {
        if (costWarningDismissed && estimationState.estimation) {
            /* eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: reset UI when external data changes */
            setCostWarningDismissed(false);
        }
    }, [estimationState.estimation, costWarningDismissed]);

    // Clear deck search when dropdown closes
    useEffect(() => {
        if (!isDeckOpen) {
            /* eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: reset derived UI when dropdown closes */
            setDeckSearchQuery('');
        }
    }, [isDeckOpen]);

    // Auto-expand matched tree nodes while searching (preserves manual expansion state).
    useEffect(() => {
        if (!deckSearchQuery.trim() || matchedDeckNodesRef.current.size === 0) return;

        setExpandedDeckNodes(prev => {
            let changed = false;
            const next = new Set(prev);
            for (const nodeName of matchedDeckNodesRef.current) {
                if (!next.has(nodeName)) {
                    next.add(nodeName);
                    changed = true;
                }
            }
            return changed ? next : prev;
        });
    }, [deckSearchQuery]);

    // ---------------------------------------------------------------------------
    // Computed values (derived state)
    // ---------------------------------------------------------------------------

    // Slider config for ConfigurationCard
    const sliderConfig = useMemo((): SliderConfig => {
        const config = computeTargetSliderConfig(estimationState.estimation?.suggested_card_count);
        return {
            ...config,
            suggested: estimationState.estimation?.suggested_card_count ?? null,
        };
    }, [estimationState.estimation?.suggested_card_count]);

    // Estimation display for ConfigurationCard
    const estimationDisplay = useMemo((): EstimationDisplay => ({
        phase: estimationPhase,
        suggestedCount: estimationState.estimation?.suggested_card_count ?? null,
        documentType:
            estimationState.estimation?.document_type === 'slides' || estimationState.estimation?.document_type === 'script'
                ? estimationState.estimation.document_type
                : null,
        error: estimationState.estimationError
            ? translateError(estimationState.estimationError, 'estimation')
            : null,
        isEstimating: estimationState.isEstimating,
    }), [estimationPhase, estimationState]);

    // Should show cost warning
    const shouldShowCostWarning = useMemo(() => {
        const estimatedCost = estimationState.estimation?.cost ?? 0;
        return !estimationState.isEstimating && estimatedCost > COST_WARNING_THRESHOLD && !costWarningDismissed;
    }, [estimationState.estimation?.cost, estimationState.isEstimating, costWarningDismissed]);

    // Validation state for GenerationSummaryCard
    const validationState = useMemo((): ValidationState => ({
        isButtonDisabled: validation.isButtonDisabled,
        disabledReason: validation.disabledReason,
        showCostWarning,
        attemptedSubmit,
    }), [validation, showCostWarning, attemptedSubmit]);

    // ---------------------------------------------------------------------------
    // Callbacks
    // ---------------------------------------------------------------------------

    const handleGenerateClick = useCallback(() => {
        if (validation.isButtonDisabled) {
            setAttemptedSubmit(true);
            return;
        }
        if (shouldShowCostWarning) {
            setShowCostWarning(true);
            return;
        }
        handleGenerate();
    }, [validation.isButtonDisabled, shouldShowCostWarning, handleGenerate]);

    const handleConfirmCostWarning = useCallback(() => {
        setShowCostWarning(false);
        setCostWarningDismissed(true);
        handleGenerate();
    }, [handleGenerate]);

    const handleDismissCostWarning = useCallback(() => {
        setShowCostWarning(false);
        setCostWarningDismissed(true);
    }, []);

    const handleCreateDeck = useCallback(async (name: string): Promise<boolean> => {
        try {
            await createDeckMutation.mutateAsync(name);
            return true;
        } catch (e) {
            console.error('Failed to create deck', e);
            return false;
        }
    }, [createDeckMutation]);

    const handleToggleDeckNode = useCallback((nodeName: string) => {
        setExpandedDeckNodes(prev => {
            const next = new Set(prev);
            if (next.has(nodeName)) {
                next.delete(nodeName);
            } else {
                next.add(nodeName);
            }
            return next;
        });
    }, []);

    // Deck selector props
    const deckSelectorProps = useMemo((): Omit<DeckSelectorProps, 'disabled'> => ({
        value: deckState.deckName,
        availableDecks,
        isLoading: isLoadingDecks,
        isOpen: isDeckOpen,
        searchQuery: deckSearchQuery,
        expandedNodes: expandedDeckNodes,
        onChange: actions.setDeckName,
        onCreate: handleCreateDeck,
        onOpenChange: setIsDeckOpen,
        onSearchChange: setDeckSearchQuery,
        onToggleNode: handleToggleDeckNode,
        onSearchMatchesChange: (matches) => {
            matchedDeckNodesRef.current = matches;
        },
    }), [
        deckState.deckName,
        availableDecks,
        isLoadingDecks,
        isDeckOpen,
        deckSearchQuery,
        expandedDeckNodes,
        actions.setDeckName,
        handleCreateDeck,
        handleToggleDeckNode,
    ]);

    // ---------------------------------------------------------------------------
    // Animation variants
    // ---------------------------------------------------------------------------

    const containerVariants = {
        hidden: { opacity: 0 },
        show: {
            opacity: 1,
            transition: { staggerChildren: 0.1 }
        }
    };

    const itemVariants = {
        hidden: { opacity: 0, y: 20 },
        show: { opacity: 1, y: 0 }
    };

    // ---------------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------------

    return (
        <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="show"
            exit={{ opacity: 0, y: -20 }}
            className="grid grid-cols-1 lg:grid-cols-12 gap-8"
        >
            {/* LEFT COLUMN: Source & Configuration */}
            <motion.div variants={itemVariants} className="lg:col-span-7 space-y-8">
                <SourceMaterialCard
                    file={sourceState.pdfFile}
                    onFileSelect={actions.setPdfFile}
                />
                <ConfigurationCard
                    targetDeckSize={configState.targetDeckSize}
                    sliderConfig={sliderConfig}
                    focusPrompt={configState.focusPrompt}
                    estimation={estimationDisplay}
                    onTargetDeckSizeChange={actions.setTargetDeckSize}
                    onFocusPromptChange={actions.setFocusPrompt}
                />
            </motion.div>

            {/* RIGHT COLUMN: Summary & Action */}
            <motion.div variants={itemVariants} className="lg:col-span-5">
                <GenerationSummaryCard
                    summary={summaryInfo}
                    cost={costDisplay}
                    estimation={{
                        phase: estimationPhase,
                        cost: costDisplay,
                        isEstimating: estimationState.isEstimating,
                    }}
                    validation={validationState}
                    health={{ ankiConnected: health?.anki_connected ?? false }}
                    deckSelectorProps={deckSelectorProps}
                    onGenerate={handleGenerateClick}
                    onDismissCostWarning={handleDismissCostWarning}
                    onConfirmCostWarning={handleConfirmCostWarning}
                    onAttemptedSubmit={() => setAttemptedSubmit(true)}
                />
            </motion.div>
        </motion.div>
    );
}

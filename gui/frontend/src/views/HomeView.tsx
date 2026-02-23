import { motion } from 'framer-motion';
import { SourceMaterialCard } from '../components/SourceMaterialCard';
import { ConfigurationCard } from '../components/ConfigurationCard';
import { GenerationSummaryCard } from '../components/GenerationSummaryCard';
import type { HealthStatus } from '../hooks/useAppState';
import { useEstimationLogic } from '../hooks/useEstimationLogic';

interface HomeViewProps {
    handleGenerate: () => void;
    health: HealthStatus | null;
}

export function HomeView({
    handleGenerate,
    health,
}: HomeViewProps) {
    useEstimationLogic(health);

    const containerVariants = {
        hidden: { opacity: 0 },
        show: {
            opacity: 1,
            transition: {
                staggerChildren: 0.1
            }
        }
    };

    const itemVariants = {
        hidden: { opacity: 0, y: 20 },
        show: { opacity: 1, y: 0 }
    };

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
                <SourceMaterialCard />
                <ConfigurationCard />
            </motion.div>

            {/* RIGHT COLUMN: Summary & Action */}
            <motion.div variants={itemVariants} className="lg:col-span-5">
                <GenerationSummaryCard handleGenerate={handleGenerate} health={health} />
            </motion.div>
        </motion.div>
    );
}

import { Fragment } from 'react';
import { Check, Loader, AlertTriangle } from 'lucide-react';

const PIPELINE_STEPS = [
  { key: 'plan', label: 'Plan', desc: 'Requirements & design' },
  { key: 'exec', label: 'Execute', desc: 'Implementation' },
  { key: 'verify', label: 'Verify', desc: 'Testing & QA' },
  { key: 'fix', label: 'Fix', desc: 'Corrections' },
];

/**
 * Pipeline Progress — full-width stepper Plan → Execute → Verify → Fix
 * @param {{ currentStep: string, completedSteps: string[], failedSteps: string[] }} props
 */
export default function PipelineProgress({ currentStep, completedSteps = [], failedSteps = [] }) {
  return (
    <div className="flex w-full items-start">
      {PIPELINE_STEPS.map((step, i) => {
        const isCompleted = completedSteps.includes(step.key);
        const isCurrent = currentStep === step.key;
        const isFailed = failedSteps.includes(step.key);
        const isPending = !isCompleted && !isCurrent && !isFailed;

        const circleClass = (() => {
          if (isFailed) {
            return 'border-2 border-red-500/60 bg-red-600 text-white';
          }
          if (isCompleted) {
            return 'border-2 border-emerald-400 bg-emerald-500 text-white';
          }
          if (isCurrent) {
            return 'border-2 border-emerald-300 bg-emerald-500 text-white shadow-[0_0_18px_rgba(16,185,129,0.55)] ring-2 ring-emerald-400/40';
          }
          return 'border-2 border-dashed border-[#4a6a62] bg-transparent text-[#6a8a80]';
        })();

        const segment = (
          <div className="flex shrink-0 flex-col items-center">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-full text-[15px] font-semibold transition-all ${circleClass}`}
            >
              {isCompleted && <Check className="h-5 w-5 stroke-[2.5]" aria-hidden />}
              {isCurrent && <Loader className="h-5 w-5 animate-spin" aria-hidden />}
              {isFailed && <AlertTriangle className="h-5 w-5" aria-hidden />}
              {isPending && <span className="tabular-nums">{i + 1}</span>}
            </div>
            <span
              className={`mt-2 max-w-[5.5rem] text-center text-[15px] font-medium leading-tight ${
                isCompleted
                  ? 'text-emerald-400'
                  : isCurrent
                    ? 'text-emerald-300'
                    : isFailed
                      ? 'text-red-400'
                      : 'text-[#6a8a80]'
              }`}
            >
              {step.label}
            </span>
          </div>
        );

        const isLast = i === PIPELINE_STEPS.length - 1;
        if (isLast) {
          return (
            <Fragment key={step.key}>
              {segment}
            </Fragment>
          );
        }

        const lineActive = isCompleted;

        return (
          <Fragment key={step.key}>
            {segment}
            <div
              className={`mx-2 mt-5 h-[3px] min-h-[3px] min-w-[1rem] flex-1 rounded-full ${
                lineActive ? 'bg-emerald-500' : 'bg-[#1a2e28]'
              }`}
              aria-hidden
            />
          </Fragment>
        );
      })}
    </div>
  );
}

import type { WizardStep } from "../../../../lib/wizard";
import { StepFrame } from "../StepFrame";

/** 2: only to read; what to prepare in Capture One. */
export function FoldersStep({ step }: { step: WizardStep }) {
  return <StepFrame step={step} />;
}

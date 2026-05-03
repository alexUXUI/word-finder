export type {
  ChatMessage,
  GenerateRequest,
  GenerateResponse,
  LoadProgress,
  LocalModelProvider,
} from './types';
export { TransformersJsProvider } from './transformers-js';
export {
  selectSlmTier,
  selectSlmModel,
  setSlmPreference,
  readSlmPreference,
  SLM_REGISTRY,
} from './device-tier';
export type { SlmTier, SlmModel, SlmSelection, SlmRecommendation } from './device-tier';

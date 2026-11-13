import type { GeneratorErrorShape } from './types.js'

export class GeneratorError extends Error implements GeneratorErrorShape {
  readonly code: string
  readonly stage: string
  readonly nextAction: string
  readonly targetModified: boolean

  constructor(error: GeneratorErrorShape, options?: ErrorOptions) {
    super(error.message, options)
    this.name = 'GeneratorError'
    this.code = error.code
    this.stage = error.stage
    this.nextAction = error.nextAction
    this.targetModified = error.targetModified
  }

  toJSON(): GeneratorErrorShape {
    return {
      code: this.code,
      stage: this.stage,
      message: this.message,
      nextAction: this.nextAction,
      targetModified: this.targetModified,
    }
  }
}

export function asGeneratorError(error: unknown, stage: string): GeneratorError {
  if (error instanceof GeneratorError) return error
  return new GeneratorError({
    code: 'GEN_INTERNAL_ERROR',
    stage,
    message: 'Unexpected generator error.',
    nextAction: 'Review the local redacted job log and retry from a new destination.',
    targetModified: false,
  }, { cause: error })
}

export function configError(message: string): GeneratorError {
  return new GeneratorError({
    code: 'GEN_CONFIG_INVALID',
    stage: 'plan',
    message,
    nextAction: 'Correct the config to match the versioned ProjectSelectionV1 schema.',
    targetModified: false,
  })
}

export function incompatibleError(message: string): GeneratorError {
  return new GeneratorError({
    code: 'GEN_INCOMPATIBLE',
    stage: 'resolve',
    message,
    nextAction: 'Choose one of the explicitly cataloged frontend recipes.',
    targetModified: false,
  })
}

# DRAFT, not filed. Verify on real Gemini Nano before filing.

Target repo: `firebase/firebase-js-sdk`. Observed in `@firebase/ai` 3.1.0 (the `firebase` 13.3.0 package).

## Title
`PREFER_ON_DEVICE`: an error from on-device inference is not caught, so there is no cloud fallback after `isAvailable()` passes

## What the code does
In `callCloudOrDevice` (`packages/ai`), the `PREFER_ON_DEVICE` case is:

```js
case InferenceMode.PREFER_ON_DEVICE:
    if (await chromeAdapter.isAvailable(request)) {
        return { response: await onDeviceCall(), inferenceSource: InferenceSource.ON_DEVICE };
    }
    // ...falls through to the cloud only when isAvailable() is false
```

`onDeviceCall()` is not inside a `try/catch`. If the Prompt API session fails after availability is
reported (a crash, an input-quota error), the error reaches the app. `PREFER_IN_CLOUD`, by contrast, does
catch cloud errors (`errorsCausingFallback`) and falls back to the device.

## Question
Is the absence of a fallback for on-device inference errors intended? The docs describe falling back
"otherwise", which reads as "when the model is unavailable", but an app that chose a hybrid mode for
resilience may expect a failed on-device call to fall back too.

## Minimal repro (no download needed)

```js
window.LanguageModel = {
  availability: async () => 'available',
  create: async () => ({ prompt: async () => { throw new DOMException('boom', 'UnknownError'); }, destroy() {} }),
};
const model = getGenerativeModel(getAI(app, { backend: new GoogleAIBackend() }), { mode: InferenceMode.PREFER_ON_DEVICE });
await model.generateContent('hi'); // rejects with the device error; the cloud is never tried
```

Same test in this repo: `test/firebase.test.ts`, "baseline: stock PREFER_ON_DEVICE ...".

## On real hardware (to confirm first)
On a machine with Gemini Nano, send a prompt larger than `session.inputQuota` in `PREFER_ON_DEVICE`. The
Continuum demo has a "Force a real device failure" switch that does this.

## Not claimed
- Android: the Android SDK has a fallback provider and commits about on-device exceptions (firebase-android-sdk
  #7739, #7755 by title). I have not read that code, so I make no claim about parity.
- The numbered issues in the project notes (#1078, #1061, #1019, #1070, #1080) were not located or
  verified here. They are described as Android cases, which would not transfer to web automatically.

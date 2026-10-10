export function requiredAdmissionDocumentTypes({ admissionType = '', className = '' } = {}) {
  const isStaff = ['ALREADY_ENROLLED', 'TRANSFER', 'FIRST_TIME'].includes(admissionType);
  if (isStaff && admissionType === 'ALREADY_ENROLLED') return [];
  const required = ['PASSPORT_PHOTOGRAPHS', 'BIRTH_CERTIFICATE_OR_GHANA_CARD', 'NHIS_CARD'];
  if (/^(primary|basic|jhs)/i.test(String(className).trim())) required.push('LAST_ACADEMIC_REPORT');
  if (isStaff) required.push('ADMISSION_RECEIPT');
  return required;
}

export function createAdmissionFormNavigator({ steps, validateStep, onStepChange = () => {}, now = () => Date.now(), minimumAdvanceInterval = 250 }) {
  if (!Array.isArray(steps) || steps.length === 0) throw new TypeError('At least one admission form step is required.');
  if (typeof validateStep !== 'function') throw new TypeError('A step validator is required.');

  let currentStep = 0;
  let lastAdvanceAt = Number.NEGATIVE_INFINITY;

  function render() {
    steps.forEach((step, index) => {
      const active = index === currentStep;
      step.hidden = !active;
      step.setAttribute?.('aria-hidden', String(!active));
    });
    onStepChange({ currentStep, totalSteps: steps.length, step: steps[currentStep] });
  }

  render();
  return Object.freeze({
    get currentStep() { return currentStep; },
    get totalSteps() { return steps.length; },
    get isLastStep() { return currentStep === steps.length - 1; },
    validateCurrentStep() { return validateStep(steps[currentStep], currentStep) !== false; },
    next() {
      const timestamp = now();
      if (timestamp - lastAdvanceAt < minimumAdvanceInterval) return false;
      if (!validateStep(steps[currentStep], currentStep)) return false;
      if (currentStep >= steps.length - 1) return false;
      lastAdvanceAt = timestamp;
      currentStep += 1;
      render();
      return true;
    },
    back() {
      if (currentStep === 0) return false;
      currentStep -= 1;
      render();
      return true;
    },
  });
}

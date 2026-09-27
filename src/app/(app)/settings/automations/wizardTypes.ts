// Reference data the wizard's editors pick from (loaded once by AutomationWizard).
export interface WizardOption {
  value: string;
  label: string;
}

export interface WizardRefs {
  stages: WizardOption[];
  users: WizardOption[];
  activityTypes: WizardOption[];
}

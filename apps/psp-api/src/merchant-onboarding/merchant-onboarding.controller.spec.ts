import { MerchantOnboardingController } from './merchant-onboarding.controller';
import { MerchantOnboardingOpsController } from './merchant-onboarding-ops.controller';
import { CreateMerchantOnboardingApplicationDto } from './dto/create-merchant-onboarding-application.dto';
import { ListMerchantOnboardingApplicationsQueryDto } from './dto/list-merchant-onboarding-applications-query.dto';
import { RejectMerchantOnboardingDto } from './dto/reject-merchant-onboarding.dto';
import { SubmitBusinessProfileDto } from './dto/submit-business-profile.dto';
import { MerchantOnboardingService } from './merchant-onboarding.service';

type ServiceMethods = Pick<
  MerchantOnboardingService,
  | 'createApplication'
  | 'validateToken'
  | 'submitBusinessProfile'
  | 'listApplications'
  | 'getApplication'
  | 'approveApplication'
  | 'rejectApplication'
  | 'resendLink'
>;

describe('MerchantOnboardingController', () => {
  let service: jest.Mocked<ServiceMethods>;
  let controller: MerchantOnboardingController;

  beforeEach(() => {
    service = {
      createApplication: jest.fn(),
      validateToken: jest.fn(),
      submitBusinessProfile: jest.fn(),
      listApplications: jest.fn(),
      getApplication: jest.fn(),
      approveApplication: jest.fn(),
      rejectApplication: jest.fn(),
      resendLink: jest.fn(),
    };
    controller = new MerchantOnboardingController(service as unknown as MerchantOnboardingService);
  });

  it('delegates public application creation to the service', () => {
    const dto: CreateMerchantOnboardingApplicationDto = {
      name: 'Acme PSP',
      email: 'ops@acme.test',
      phone: '+34600000000',
    };
    const expected = { message: 'sent' };
    service.createApplication.mockReturnValue(expected as never);

    const result = controller.createApplication(dto);

    expect(result).toBe(expected);
    expect(service.createApplication).toHaveBeenCalledWith(dto);
  });

  it('delegates public token validation to the service', () => {
    const expected = { applicationId: 'app_123' };
    service.validateToken.mockReturnValue(expected as never);

    const result = controller.validateToken('public-token');

    expect(result).toBe(expected);
    expect(service.validateToken).toHaveBeenCalledWith('public-token');
  });

  it('delegates public business profile submission to the service', () => {
    const dto: SubmitBusinessProfileDto = {
      tradeName: 'Acme PSP',
      legalName: 'Acme PSP SL',
      country: 'ES',
      website: 'https://acme.test',
      businessType: 'payments',
    };
    const expected = { status: 'UNDER_REVIEW' };
    service.submitBusinessProfile.mockReturnValue(expected as never);

    const result = controller.submitBusinessProfile('public-token', dto);

    expect(result).toBe(expected);
    expect(service.submitBusinessProfile).toHaveBeenCalledWith('public-token', dto);
  });
});

describe('MerchantOnboardingOpsController', () => {
  let service: jest.Mocked<ServiceMethods>;
  let controller: MerchantOnboardingOpsController;

  beforeEach(() => {
    service = {
      createApplication: jest.fn(),
      validateToken: jest.fn(),
      submitBusinessProfile: jest.fn(),
      listApplications: jest.fn(),
      getApplication: jest.fn(),
      approveApplication: jest.fn(),
      rejectApplication: jest.fn(),
      resendLink: jest.fn(),
    };
    controller = new MerchantOnboardingOpsController(
      service as unknown as MerchantOnboardingService,
    );
  });

  it('delegates internal application listing to the service', () => {
    const query: ListMerchantOnboardingApplicationsQueryDto = { status: 'IN_REVIEW' };
    const expected = { items: [] };
    service.listApplications.mockReturnValue(expected as never);

    const result = controller.listApplications(query);

    expect(result).toBe(expected);
    expect(service.listApplications).toHaveBeenCalledWith(query);
  });

  it('delegates internal application detail to the service', () => {
    const expected = { id: 'app_123' };
    service.getApplication.mockReturnValue(expected as never);

    const result = controller.getApplication('app_123');

    expect(result).toBe(expected);
    expect(service.getApplication).toHaveBeenCalledWith('app_123');
  });

  it('delegates internal approval to the service', () => {
    const expected = { status: 'APPROVED' };
    service.approveApplication.mockReturnValue(expected as never);

    const result = controller.approve('app_123');

    expect(result).toBe(expected);
    expect(service.approveApplication).toHaveBeenCalledWith('app_123');
  });

  it('delegates internal rejection to the service', () => {
    const dto: RejectMerchantOnboardingDto = { reason: 'Missing business data' };
    const expected = { status: 'REJECTED' };
    service.rejectApplication.mockReturnValue(expected as never);

    const result = controller.reject('app_123', dto);

    expect(result).toBe(expected);
    expect(service.rejectApplication).toHaveBeenCalledWith('app_123', dto);
  });

  it('delegates internal link resend to the service', () => {
    const expected = { message: 'resent' };
    service.resendLink.mockReturnValue(expected as never);

    const result = controller.resendLink('app_123');

    expect(result).toBe(expected);
    expect(service.resendLink).toHaveBeenCalledWith('app_123');
  });
});

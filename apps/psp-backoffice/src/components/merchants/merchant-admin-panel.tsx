"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchMerchantsOpsDetail,
  patchMerchantOpsAccount,
  type PatchMerchantAccountBody,
} from "@/lib/api/client";
import type {
  MerchantIndustry,
  MerchantRegistrationStatus,
  MerchantsOpsDetailResponse,
} from "@/lib/api/contracts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { MerchantProviderRatesPanel } from "@/components/merchants/merchant-provider-rates-panel";

type MerchantAdminTab = "account" | "application-form" | "provider-rates";

type AccountFormState = {
  name: string;
  email: string;
  contactName: string;
  contactPhone: string;
  websiteUrl: string;
  isActive: boolean;
  registrationStatus: MerchantRegistrationStatus;
  registrationNumber: string;
  industry: MerchantIndustry;
};

const registrationStatusOptions: Array<{ value: MerchantRegistrationStatus; label: string }> = [
  { value: "LEAD", label: "Lead" },
  { value: "IN_REVIEW", label: "In review" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "ACTIVE", label: "Active" },
];

const industryOptions: Array<{ value: MerchantIndustry; label: string }> = [
  { value: "CLOUD_COMPUTING", label: "Cloud computing" },
  { value: "CRYPTO", label: "Crypto" },
  { value: "FOREX", label: "Forex" },
  { value: "GAMBLING", label: "Gambling" },
  { value: "PSP", label: "PSP" },
  { value: "OTHER", label: "Other" },
];

function accountFormFromDetail(data: MerchantsOpsDetailResponse): AccountFormState {
  return {
    name: data.merchant.name,
    email: data.merchant.email ?? "",
    contactName: data.merchant.contactName ?? "",
    contactPhone: data.merchant.contactPhone ?? "",
    websiteUrl: data.merchant.websiteUrl ?? "",
    isActive: data.merchant.isActive,
    registrationStatus: data.merchant.registrationStatus,
    registrationNumber: data.merchant.registrationNumber ?? "",
    industry: data.merchant.industry,
  };
}

function patchBodyFromAccountForm(formState: AccountFormState): PatchMerchantAccountBody {
  const body: PatchMerchantAccountBody = {
    isActive: formState.isActive,
    registrationStatus: formState.registrationStatus,
    industry: formState.industry,
  };
  const name = formState.name.trim();
  if (name !== "") {
    body.name = name;
  }
  const email = formState.email.trim();
  if (email !== "") {
    body.email = email;
  }
  const contactName = formState.contactName.trim();
  if (contactName !== "") {
    body.contactName = contactName;
  }
  const contactPhone = formState.contactPhone.trim();
  if (contactPhone !== "") {
    body.contactPhone = contactPhone;
  }
  const websiteUrl = formState.websiteUrl.trim();
  body.websiteUrl = websiteUrl === "" ? null : websiteUrl;
  const registrationNumber = formState.registrationNumber.trim();
  body.registrationNumber = registrationNumber === "" ? null : registrationNumber;
  return body;
}

export function MerchantAdminPanel({ merchantId }: { merchantId: string }) {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<MerchantAdminTab>("account");
  const [note, setNote] = useState<string | null>(null);
  const [form, setForm] = useState<AccountFormState | null>(null);

  const detailQuery = useQuery({
    queryKey: ["merchant-ops-detail-admin", merchantId],
    queryFn: () => fetchMerchantsOpsDetail(merchantId),
    staleTime: 15_000,
  });

  useEffect(() => {
    if (detailQuery.data) {
      /* Sync local edit state when detail refetches; plan Task 7 pattern. */
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: reset form from server
      setForm(accountFormFromDetail(detailQuery.data));
    }
  }, [detailQuery.data]);

  const patchAccount = useMutation({
    mutationFn: (formState: AccountFormState) =>
      patchMerchantOpsAccount(merchantId, patchBodyFromAccountForm(formState)),
    onSuccess: async () => {
      setNote("Cuenta actualizada.");
      await qc.invalidateQueries({ queryKey: ["merchant-ops-detail-admin", merchantId] });
      await qc.invalidateQueries({ queryKey: ["merchants-ops-directory"] });
    },
    onError: (e: Error) => setNote(e.message),
  });

  const data = detailQuery.data;
  const merchant = data?.merchant;
  const tabs: Array<{ id: MerchantAdminTab; label: string }> = [
    { id: "account", label: "Account" },
    { id: "application-form", label: "Application Form" },
    { id: "provider-rates", label: "Provider rates" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Edit Merchant</h1>
          <p className="mt-1 text-sm text-slate-600">{merchant?.name ?? merchantId}</p>
        </div>
        {merchant?.mid ? (
          <p className="text-lg font-semibold text-slate-700">MID: {merchant.mid}</p>
        ) : null}
      </div>

      <div className="border-b border-slate-200">
        <nav className="-mb-px flex flex-wrap gap-6" aria-label="Merchant admin tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={
                activeTab === tab.id
                  ? "border-b-2 border-[var(--primary)] px-1 py-3 text-sm font-semibold text-[var(--primary)]"
                  : "border-b-2 border-transparent px-1 py-3 text-sm font-medium text-slate-500 hover:text-slate-700"
              }
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {note ? <p className="text-sm text-slate-700">{note}</p> : null}
      {detailQuery.isLoading ? <p className="text-sm text-slate-500">Cargando...</p> : null}
      {detailQuery.isError ? <p className="text-sm text-rose-700">{(detailQuery.error as Error).message}</p> : null}

      {data && activeTab === "account" && form ? (
        <AccountTab
          form={form}
          setForm={setForm}
          mid={data.merchant.mid}
          saving={patchAccount.isPending}
          onCancel={() => setForm(accountFormFromDetail(data))}
          onSave={() => patchAccount.mutate(form)}
        />
      ) : null}
      {data && activeTab === "application-form" ? <ApplicationFormTab data={data} /> : null}
      {data && activeTab === "provider-rates" ? <MerchantProviderRatesPanel merchantId={merchantId} /> : null}
    </div>
  );
}

function AccountTab({
  form,
  setForm,
  mid,
  saving,
  onCancel,
  onSave,
}: {
  form: AccountFormState;
  setForm: (next: AccountFormState) => void;
  mid: string;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Account</CardTitle>
        <CardDescription>Datos administrativos principales del merchant.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 lg:grid-cols-3">
          <InputField label="Company name" value={form.name} onChange={(name) => setForm({ ...form, name })} />
          <InputField label="E-mail" type="email" value={form.email} onChange={(email) => setForm({ ...form, email })} />
          <InputField label="Contact name" value={form.contactName} onChange={(contactName) => setForm({ ...form, contactName })} />
          <InputField label="Contact phone" value={form.contactPhone} onChange={(contactPhone) => setForm({ ...form, contactPhone })} />
          <InputField label="Website URL" type="url" value={form.websiteUrl} onChange={(websiteUrl) => setForm({ ...form, websiteUrl })} />
          <InputField label="MID" value={mid} readOnly onChange={() => undefined} />
          <SelectField
            label="Status"
            value={form.isActive ? "ENABLED" : "DISABLED"}
            options={[
              { value: "ENABLED", label: "Enabled" },
              { value: "DISABLED", label: "Disabled" },
            ]}
            onChange={(value) => setForm({ ...form, isActive: value === "ENABLED" })}
          />
          <SelectField
            label="Registration status"
            value={form.registrationStatus}
            options={registrationStatusOptions}
            onChange={(registrationStatus) => setForm({ ...form, registrationStatus: registrationStatus as MerchantRegistrationStatus })}
          />
          <InputField
            label="Registration number"
            value={form.registrationNumber}
            onChange={(registrationNumber) => setForm({ ...form, registrationNumber })}
          />
          <SelectField
            label="Industry type"
            value={form.industry}
            options={industryOptions}
            onChange={(industry) => setForm({ ...form, industry: industry as MerchantIndustry })}
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="button" disabled={saving} onClick={onSave}>
            Save changes
          </Button>
          <Button type="button" variant="secondary" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function InputField({
  label,
  value,
  onChange,
  type = "text",
  readOnly = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  readOnly?: boolean;
}) {
  const id = useMemo(() => label.toLowerCase().replaceAll(" ", "-"), [label]);
  return (
    <label className="space-y-1.5 text-sm">
      <span className="block text-xs font-medium text-slate-600">{label}</span>
      <Input
        id={id}
        type={type}
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        className={readOnly ? "bg-slate-50 text-slate-500" : undefined}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1.5 text-sm">
      <span className="block text-xs font-medium text-slate-600">{label}</span>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </label>
  );
}

function ApplicationFormTab({ data }: { data: MerchantsOpsDetailResponse }) {
  if (data.onboardingEvents.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Application Form</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-500">No hay historial de onboarding para este merchant.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Application Form</CardTitle>
        <CardDescription>
          Historial cronológico del expediente más reciente (como máximo {data.onboardingEventsLimit}{" "}
          eventos más recientes).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {data.onboardingEvents.map((event) => (
            <div key={event.id} className="rounded-lg border border-slate-100 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-slate-900">{event.type}</span>
                <span className="text-xs text-slate-500">{new Date(event.createdAt).toLocaleString()}</span>
              </div>
              <p className="mt-1 text-slate-600">{event.message}</p>
              <p className="mt-1 text-xs text-slate-400">Actor: {event.actorType}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}


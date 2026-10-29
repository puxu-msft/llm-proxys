"use client";

import PropTypes from "prop-types";
import Input from "@/shared/components/Input";
import Select from "@/shared/components/Select";

// registry 的 connectionFields 声明的连接级可调项（base url、报文格式等）。
// 字段值最终写进连接的 providerSpecificData，请求时由 open-sse 的 transportOverride 生效。
export default function ProviderConnectionFields({ fields, values, onChange }) {
  if (!fields?.length) return null;

  return (
    <div className="bg-sidebar/50 p-4 rounded-lg border border-accent/20 flex flex-col gap-3">
      {fields.map((field) => {
        const value = values?.[field.id] ?? field.defaultValue ?? "";
        const handleChange = (e) => onChange?.(field.id, e.target.value);
        if (field.type === "select") {
          return (
            <Select
              key={field.id}
              label={field.label}
              value={value}
              onChange={handleChange}
              options={field.options || []}
              hint={field.hint}
              placeholder={field.placeholder}
            />
          );
        }
        return (
          <Input
            key={field.id}
            label={field.label}
            value={value}
            onChange={handleChange}
            placeholder={field.placeholder}
            hint={field.hint}
          />
        );
      })}
    </div>
  );
}

ProviderConnectionFields.propTypes = {
  fields: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string.isRequired,
    label: PropTypes.string,
    type: PropTypes.string,
    options: PropTypes.array,
    placeholder: PropTypes.string,
    hint: PropTypes.string,
    defaultValue: PropTypes.string,
  })),
  values: PropTypes.object,
  onChange: PropTypes.func,
};

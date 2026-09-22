"use client";

import { cloneElement, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactElement } from "react";
import type { SlideElementKind, SlideElementStyle } from "@/types/presentation";

export type CanvasEditor = {
  enabled: boolean;
  selectedIds: string[];
  onSelect: (id: string, kind: SlideElementKind, rect: DOMRect, additive: boolean) => void;
  onCommitText: (id: string, value: string) => void;
};

type EditableElementProps = {
  id: string;
  kind: SlideElementKind;
  state?: SlideElementStyle;
  editor?: CanvasEditor;
  value?: string;
  multiline?: boolean;
  children: ReactElement<Record<string, unknown>>;
};

export function elementId(slideId: string, kind: SlideElementKind, index?: number) {
  return `${slideId}::${kind}${typeof index === "number" ? `::${index}` : ""}`;
}

export function EditableElement({ id, kind, state, editor, value, multiline = true, children }: EditableElementProps) {
  const selected = Boolean(editor?.selectedIds.includes(id));
  const canEditText = value !== undefined && selected && !state?.locked;
  const childProps = children.props;
  const childStyle = (childProps.style || {}) as CSSProperties;
  const childClassName = typeof childProps.className === "string" ? childProps.className : "";
  const movement = `translate3d(${state?.offsetX || 0}cqw, ${state?.offsetY || 0}cqw, 0) scale(${state?.scale || 1})`;
  const editableClassName = editor?.enabled
    ? state?.locked
      ? " cursor-not-allowed outline outline-1 outline-dashed outline-white/25"
      : selected
        ? " cursor-text outline outline-2 outline-white outline-offset-2"
        : " cursor-pointer hover:outline hover:outline-1 hover:outline-white/55 hover:outline-offset-2"
    : "";

  const handleClick = (event: MouseEvent<HTMLElement>) => {
    if (!editor?.enabled) return;
    event.stopPropagation();
    const target = event.currentTarget;
    editor.onSelect(id, kind, target.getBoundingClientRect(), event.shiftKey);
    if (value !== undefined && !state?.locked) window.requestAnimationFrame(() => target.focus());
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!multiline && event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    }
    if (event.key === "Escape") event.currentTarget.blur();
  };

  return cloneElement(children, {
    "data-element-id": id,
    "data-element-kind": kind,
    className: `${childClassName}${editableClassName}`,
    style: {
      ...childStyle,
      color: state?.color || childStyle.color,
      fontSize: state?.fontSize ? `${state.fontSize}cqw` : childStyle.fontSize,
      fontWeight: state?.fontWeight || childStyle.fontWeight,
      textAlign: state?.textAlign || childStyle.textAlign,
      transform: movement,
      transformOrigin: "center",
      transition: editor?.enabled ? "outline-color 160ms ease, transform 160ms ease" : childStyle.transition,
    },
    contentEditable: canEditText,
    suppressContentEditableWarning: true,
    spellCheck: canEditText,
    onClick: handleClick,
    onKeyDown: handleKeyDown,
    onBlur: canEditText
      ? (event: { currentTarget: HTMLElement }) => editor?.onCommitText(id, event.currentTarget.innerText.trim())
      : undefined,
    title: editor?.enabled ? (state?.locked ? "Locked element" : "Click to edit · Shift-click to multi-select") : childProps.title,
  });
}

import React, { memo } from 'react';
import { createPortal } from 'react-dom';

import SuperCmdRead from '../SuperCmdRead';
import WindowManagerPanel from '../WindowManagerPanel';

import type { UseCursorPromptReturn } from '../hooks/useCursorPrompt';
import type {  } from '../utils/command-helpers';
import CursorPromptView from '../views/CursorPromptView';

type DetachedOverlayRunnersProps = {

  showWindowManager: boolean;
  windowManagerPortalTarget: HTMLElement | null;
  onWindowManagerClose: () => void;

  showCursorPrompt: boolean;
  cursorPromptPortalTarget: HTMLElement | null;
  cursorPromptText: string;
  setCursorPromptText: (text: string) => void;
  cursorPromptStatus: UseCursorPromptReturn['cursorPromptStatus'];
  cursorPromptResult: string;
  cursorPromptError: string;
  cursorPromptInputRef: React.RefObject<HTMLTextAreaElement>;
  aiAvailable: boolean;
  submitCursorPrompt: () => void;
  closeCursorPrompt: () => void;
  acceptCursorPrompt: () => void;
};

const DetachedOverlayRunners: React.FC<DetachedOverlayRunnersProps> = ({

  showWindowManager,
  windowManagerPortalTarget,
  onWindowManagerClose,
  showCursorPrompt,
  cursorPromptPortalTarget,
  cursorPromptText,
  setCursorPromptText,
  cursorPromptStatus,
  cursorPromptResult,
  cursorPromptError,
  cursorPromptInputRef,
  aiAvailable,
  submitCursorPrompt,
  closeCursorPrompt,
  acceptCursorPrompt,
}) => {
  return (
    <>

      {showWindowManager && windowManagerPortalTarget ? (
        <WindowManagerPanel
          show={showWindowManager}
          portalTarget={windowManagerPortalTarget}
          onClose={onWindowManagerClose}
        />
      ) : null}
      {showCursorPrompt && cursorPromptPortalTarget
        ? createPortal(
            <CursorPromptView
              variant="portal"
              cursorPromptText={cursorPromptText}
              setCursorPromptText={setCursorPromptText}
              cursorPromptStatus={cursorPromptStatus}
              cursorPromptResult={cursorPromptResult}
              cursorPromptError={cursorPromptError}
              cursorPromptInputRef={cursorPromptInputRef}
              aiAvailable={aiAvailable}
              submitCursorPrompt={submitCursorPrompt}
              closeCursorPrompt={closeCursorPrompt}
              acceptCursorPrompt={acceptCursorPrompt}
            />,
            cursorPromptPortalTarget
          )
        : null}
    </>
  );
};

export default memo(DetachedOverlayRunners);

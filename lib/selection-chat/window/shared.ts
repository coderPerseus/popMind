export const SelectionChatWindowChannel = {
  State: 'selectionChatWindow:state',
  GetState: 'selectionChatWindow:getState',
  SubmitMessage: 'selectionChatWindow:submitMessage',
  Regenerate: 'selectionChatWindow:regenerate',
  Stop: 'selectionChatWindow:stop',
  SetPinned: 'selectionChatWindow:setPinned',
  SetDragging: 'selectionChatWindow:setDragging',
  CopyMessage: 'selectionChatWindow:copyMessage',
  Close: 'selectionChatWindow:close',
  DismissTopmost: 'selectionChatWindow:dismissTopmost',
  NotifyInteraction: 'selectionChatWindow:notifyInteraction',
  Move: 'selectionChatWindow:move',
} as const

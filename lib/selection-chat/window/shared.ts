export const SelectionChatWindowChannel = {
  State: 'selectionChatWindow:state',
  GetState: 'selectionChatWindow:getState',
  SubmitMessage: 'selectionChatWindow:submitMessage',
  Stop: 'selectionChatWindow:stop',
  SetPinned: 'selectionChatWindow:setPinned',
  CopyMessage: 'selectionChatWindow:copyMessage',
  Close: 'selectionChatWindow:close',
  DismissTopmost: 'selectionChatWindow:dismissTopmost',
  NotifyInteraction: 'selectionChatWindow:notifyInteraction',
  Move: 'selectionChatWindow:move',
} as const

#import <AppKit/AppKit.h>
#ifndef HERMES_NATIVE_CONTROLS_TEST
#include <node_api.h>
#include <string>

static napi_threadsafe_function eventFunction;
static void deliver(napi_env env, napi_value callback, void *, void *data) {
  char *json = static_cast<char *>(data);
  if (env && callback) {
    napi_value arg, receiver;
    napi_create_string_utf8(env, json, NAPI_AUTO_LENGTH, &arg);
    napi_get_undefined(env, &receiver);
    napi_call_function(env, receiver, callback, 1, &arg, nullptr);
  }
  free(json);
}
static void emit(NSDictionary *event) {
  if (!eventFunction) return;
  NSData *data = [NSJSONSerialization dataWithJSONObject:event options:0 error:nil];
  NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
  char *copy = strdup(json.UTF8String);
  if (napi_call_threadsafe_function(eventFunction, copy, napi_tsfn_nonblocking) != napi_ok) free(copy);
}

#else
static void emit(NSDictionary *) {}
#endif

@interface HermesControlGroup : NSView
@property(copy) NSArray<NSView *> *controls;
@end
@implementation HermesControlGroup
- (BOOL)isAccessibilityElement { return YES; }
- (NSString *)accessibilityRole { return NSAccessibilityGroupRole; }
- (NSArray *)accessibilityChildren {
  NSMutableArray *children = [NSMutableArray array];
  for (NSView *control in self.controls) {
    if (!control.hiddenOrHasHiddenAncestor) [children addObject:control];
  }
  return NSAccessibilityUnignoredChildren(children);
}
@end

@interface HermesPlaceholder : NSTextField
@end
@implementation HermesPlaceholder
- (NSView *)hitTest:(NSPoint)point { return nil; }
@end

@interface HermesFace : NSView
@property(copy) NSString *color;
@property BOOL group;
@end
@implementation HermesFace
- (BOOL)isFlipped { return YES; }
- (void)drawRect:(NSRect)dirty {
  if (self.group) {
    NSImage *image = [NSImage imageWithSystemSymbolName:@"person.2.fill" accessibilityDescription:nil];
    [image drawInRect:self.bounds];
    return;
  }
  NSDictionary *palette = @{@"white": @0xe9e9e9, @"violet": @0xc3b1e7, @"green": @0xa8ccac,
                            @"orange": @0xdfb68e, @"blue": @0xa2bddb, @"pink": @0xdeb0c3};
  unsigned rgb = [palette[self.color ?: @"white"] unsignedIntValue];
  [[NSColor colorWithSRGBRed:((rgb >> 16) & 255)/255.0 green:((rgb >> 8) & 255)/255.0 blue:(rgb & 255)/255.0 alpha:1] setFill];
  NSAffineTransform *transform = [NSAffineTransform transform];
  [transform scaleXBy:self.bounds.size.width/48 yBy:self.bounds.size.height/48];
  [transform concat];
  NSBezierPath *face = [NSBezierPath bezierPath];
  [face moveToPoint:NSMakePoint(24,3)];
  [face curveToPoint:NSMakePoint(43,27) controlPoint1:NSMakePoint(36,3) controlPoint2:NSMakePoint(44,14)];
  [face curveToPoint:NSMakePoint(21,44) controlPoint1:NSMakePoint(42,39) controlPoint2:NSMakePoint(33,46)];
  [face curveToPoint:NSMakePoint(5,22) controlPoint1:NSMakePoint(9,43) controlPoint2:NSMakePoint(3,34)];
  [face curveToPoint:NSMakePoint(24,3) controlPoint1:NSMakePoint(6,10) controlPoint2:NSMakePoint(13,3)];
  [face closePath]; [face fill];
  [[NSColor colorWithWhite:21/255.0 alpha:1] setFill];
  [[NSBezierPath bezierPathWithRoundedRect:NSMakeRect(16,18,4.5,11) xRadius:2.25 yRadius:2.25] fill];
  [[NSBezierPath bezierPathWithRoundedRect:NSMakeRect(28,18,4.5,11) xRadius:2.25 yRadius:2.25] fill];
}
@end

static NSView *surface(NSView *content) {
  if (@available(macOS 26.0, *)) {
    if (!NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceTransparency) {
      NSGlassEffectView *glass = [NSGlassEffectView new];
      glass.cornerRadius = 24;
      glass.contentView = content;
      return glass;
    }
  }
  NSView *plain = [NSView new];
  plain.wantsLayer = YES;
  plain.layer.cornerRadius = 24;
  plain.layer.backgroundColor = NSColor.controlBackgroundColor.CGColor;
  [plain addSubview:content];
  content.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  return plain;
}
static void fitContent(NSView *surface, NSView *content) { content.frame = surface.bounds; }
static NSButton *button(NSString *title, NSString *label, id target, SEL action) {
  NSButton *button = [NSButton buttonWithTitle:title target:target action:action];
  button.bezelStyle = NSBezelStyleRounded;
  button.bordered = NO;
  button.font = [NSFont systemFontOfSize:13 weight:NSFontWeightMedium];
  button.toolTip = label;
  [button setAccessibilityLabel:label];
  return button;
}

@interface HermesControls : NSObject <NSTextViewDelegate>
@property(weak) NSView *host;
@property(copy) NSArray *windowChromeAccessibilityChildren;
@property(strong) NSView *headerSurface;
@property(strong) NSView *composerSurface;
@property(strong) NSView *header;
@property(strong) NSView *headerContent;
@property(strong) NSView *identity;
@property(strong) NSView *identityContent;
@property(strong) NSView *actions;
@property(strong) NSView *actionsContent;
@property(strong) NSView *backSurface;
@property(strong) NSView *backContent;
@property(strong) NSView *composer;
@property(strong) NSView *composerContent;
@property(strong) HermesFace *face;
@property(strong) NSTextField *title;
@property(strong) NSTextField *subtitle;
@property(strong) NSButton *back;
@property(strong) NSButton *details;
@property(strong) NSButton *settings;
@property(strong) NSSegmentedControl *tabs;
@property(strong) NSButton *attachment;
@property(strong) NSButton *submit;
@property(strong) NSButton *stop;
@property(strong) NSScrollView *scroll;
@property(strong) NSTextView *editor;
@property(strong) NSTextField *placeholder;
@property(strong) NSDictionary *state;
@property NSInteger sequence;
@property NSInteger lastFocusRequest;
@end
@implementation HermesControls
- (instancetype)initWithHost:(NSView *)host {
  if (!(self = [super init])) return nil;
  NSWindow *window = host.window;
  if (!window || window.contentView != host) return nil;
  self.host = host;
  NSMutableArray *chrome = [window.accessibilityChildren mutableCopy] ?: [NSMutableArray array];
  [chrome removeObjectsInArray:NSAccessibilityUnignoredChildren(@[host])];
  self.windowChromeAccessibilityChildren = chrome;
  self.headerContent = [NSView new];
  self.composerContent = [NSView new];
  self.identityContent = [NSView new];
  self.actionsContent = [NSView new];
  self.backContent = [NSView new];
  self.face = [HermesFace new];
  [self.face setAccessibilityElement:NO];
  self.title = [NSTextField labelWithString:@""];
  self.title.font = [NSFont systemFontOfSize:14 weight:NSFontWeightSemibold];
  self.title.lineBreakMode = NSLineBreakByTruncatingTail;
  self.subtitle = [NSTextField labelWithString:@""];
  self.subtitle.font = [NSFont systemFontOfSize:10];
  self.subtitle.textColor = NSColor.secondaryLabelColor;
  self.subtitle.lineBreakMode = NSLineBreakByTruncatingTail;
  [self.identityContent addSubview:self.face];
  [self.identityContent addSubview:self.title];
  [self.identityContent addSubview:self.subtitle];
  self.back = button(@"‹", @"Back", self, @selector(backAction));
  self.details = button(@"Details", @"Details", self, @selector(detailsAction));
  self.settings = button(@"⚙", @"Bot settings", self, @selector(settingsAction));
  self.tabs = [NSSegmentedControl segmentedControlWithLabels:@[@"Chat", @"Computer"] trackingMode:NSSegmentSwitchTrackingSelectOne target:self action:@selector(surfaceAction)];
  self.tabs.segmentStyle = NSSegmentStyleSeparated;
  [self.tabs setAccessibilityLabel:@"Conversation surface"];
  [self.backContent addSubview:self.back];
  [self.actionsContent addSubview:self.tabs];
  [self.actionsContent addSubview:self.details];
  [self.actionsContent addSubview:self.settings];
  self.attachment = button(@"+", @"Add attachment", self, @selector(attachmentAction));
  self.submit = button(@"Send", @"Send message", self, @selector(submitAction));
  self.stop = button(@"Stop", @"Stop", self, @selector(stopAction));
  self.editor = [[NSTextView alloc] initWithFrame:NSMakeRect(0,0,300,30)];
  self.editor.delegate = self;
  self.editor.richText = NO;
  self.editor.importsGraphics = NO;
  self.editor.drawsBackground = NO;
  self.editor.font = [NSFont systemFontOfSize:14];
  self.editor.textColor = NSColor.labelColor;
  self.editor.textContainerInset = NSMakeSize(2,5);
  self.editor.minSize = NSMakeSize(0,28);
  self.editor.maxSize = NSMakeSize(CGFLOAT_MAX,CGFLOAT_MAX);
  self.editor.verticallyResizable = YES;
  self.editor.horizontallyResizable = NO;
  self.editor.autoresizingMask = NSViewWidthSizable;
  self.editor.textContainer.widthTracksTextView = YES;
  self.editor.textContainer.containerSize = NSMakeSize(300,CGFLOAT_MAX);
  self.editor.allowsUndo = YES;
  [self.editor setAccessibilityLabel:@"Message"];
  self.scroll = [NSScrollView new];
  self.scroll.drawsBackground = NO;
  self.scroll.hasVerticalScroller = YES;
  self.scroll.autohidesScrollers = YES;
  self.scroll.documentView = self.editor;
  self.placeholder = [HermesPlaceholder labelWithString:@""];
  self.placeholder.font = self.editor.font;
  self.placeholder.textColor = NSColor.placeholderTextColor;
  [self.placeholder setAccessibilityElement:NO];
  [self.composerContent addSubview:self.scroll];
  [self.composerContent addSubview:self.placeholder];
  [self.composerContent addSubview:self.attachment];
  [self.composerContent addSubview:self.submit];
  [self.composerContent addSubview:self.stop];
  [self rebuildSurfaces];
  [NSWorkspace.sharedWorkspace.notificationCenter addObserver:self selector:@selector(accessibilityChanged:) name:NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification object:nil];
  return self;
}
- (void)rebuildSurfaces {
  [self.header removeFromSuperview]; [self.composer removeFromSuperview];
  [self.identity removeFromSuperview]; [self.actions removeFromSuperview]; [self.backSurface removeFromSuperview];
  self.identity = surface(self.identityContent);
  self.actions = surface(self.actionsContent);
  self.backSurface = surface(self.backContent);
  [self.headerContent addSubview:self.identity];
  [self.headerContent addSubview:self.actions];
  [self.headerContent addSubview:self.backSurface];
  if (@available(macOS 26.0, *)) {
    NSGlassEffectContainerView *group = [NSGlassEffectContainerView new];
    group.contentView = self.headerContent;
    group.spacing = 4;
    self.headerSurface = group;
  } else { self.headerSurface = self.headerContent; }
  self.composerSurface = surface(self.composerContent);
  HermesControlGroup *navigation = [HermesControlGroup new];
  [navigation setAccessibilityLabel:@"Conversation navigation"];
  navigation.controls = @[self.back, self.title, self.subtitle, self.tabs, self.details, self.settings];
  for (NSView *control in navigation.controls) [control setAccessibilityParent:navigation];
  [navigation addSubview:self.headerSurface];
  self.header = navigation;
  HermesControlGroup *composer = [HermesControlGroup new];
  [composer setAccessibilityLabel:@"Message composer"];
  composer.controls = @[self.attachment, self.editor, self.stop, self.submit];
  for (NSView *control in composer.controls) [control setAccessibilityParent:composer];
  [composer addSubview:self.composerSurface];
  self.composer = composer;
  [self.header setAccessibilityParent:self.host.window];
  [self.composer setAccessibilityParent:self.host.window];
  self.header.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
  self.composer.appearance = self.header.appearance;
  self.header.hidden = YES; self.composer.hidden = YES;
  [self.host addSubview:self.header positioned:NSWindowAbove relativeTo:nil];
  [self.host addSubview:self.composer positioned:NSWindowAbove relativeTo:nil];
  [self updateAccessibilityChildren];
}
- (void)accessibilityChanged:(NSNotification *)notification {
  [self rebuildSurfaces];
  if (self.state) [self present:self.state];
}
- (void)updateAccessibilityChildren {
  NSWindow *window = self.host.window;
  if (!window) return;
  NSMutableArray *children = [NSMutableArray array];
  if (self.header.superview && !self.header.hidden) [children addObject:self.header];
  // BridgedContentView owns Chromium's AX subtree and compositing host. Keep it in place.
  [children addObjectsFromArray:NSAccessibilityUnignoredChildren(@[self.host])];
  if (self.composer.superview && !self.composer.hidden) [children addObject:self.composer];
  for (id child in self.windowChromeAccessibilityChildren) {
    if (![children containsObject:child]) [children addObject:child];
  }
  window.accessibilityChildren = children;
}
- (void)hide {
  self.state = nil;
  self.header.hidden = YES; self.composer.hidden = YES;
  if (self.host.window.firstResponder == self.editor) [self.host.window makeFirstResponder:self.host];
  [self.editor unmarkText];
  self.editor.string = @"";
  self.editor.selectedRange = NSMakeRange(0,0);
  self.editor.editable = NO;
  [self.editor.undoManager removeAllActions];
  self.sequence = 0;
  self.lastFocusRequest = 0;
  [self updateAccessibilityChildren];
  if (self.host.window) NSAccessibilityPostNotification(self.host.window, NSAccessibilityLayoutChangedNotification);
}
- (void)detach {
  [NSWorkspace.sharedWorkspace.notificationCenter removeObserver:self];
  if (self.host.window.firstResponder == self.editor) [self.host.window makeFirstResponder:self.host];
  [self.header removeFromSuperview]; [self.composer removeFromSuperview];
  [self updateAccessibilityChildren];
  if (self.host.window) NSAccessibilityPostNotification(self.host.window, NSAccessibilityLayoutChangedNotification);
}
- (NSRect)rect:(NSDictionary *)rect viewport:(NSDictionary *)viewport {
  CGFloat scale = self.host.bounds.size.width / MAX(1,[viewport[@"width"] doubleValue]);
  NSRect result = NSMakeRect([rect[@"x"] doubleValue]*scale, [rect[@"y"] doubleValue]*scale, [rect[@"width"] doubleValue]*scale, [rect[@"height"] doubleValue]*scale);
  if (!self.host.isFlipped) result.origin.y = self.host.bounds.size.height - NSMaxY(result);
  return result;
}
- (BOOL)present:(NSDictionary *)state {
  if (!self.host.window) return NO;
  BOOL sameScope = [self.state[@"scopeId"] isEqual:state[@"scopeId"]] && [self.state[@"sessionId"] isEqual:state[@"sessionId"]];
  if (sameScope && [state[@"revision"] integerValue] < [self.state[@"revision"] integerValue]) return !self.header.hidden;
  if (!sameScope) { self.sequence = 0; [self.editor.undoManager removeAllActions]; }
  if (![self.state[@"sessionId"] isEqual:state[@"sessionId"]]) self.lastFocusRequest = 0;
  BOOL actionsChanged = ![self.state[@"composer"][@"stopVisible"] isEqual:state[@"composer"][@"stopVisible"]] ||
    ![self.state[@"navigation"][@"computerVisible"] isEqual:state[@"navigation"][@"computerVisible"]];
  self.state = state;
  BOOL visible = [state[@"visible"] boolValue];
  BOOL accessibilityChanged = self.header.hidden == visible ||
    self.composer.hidden == (visible && [state[@"composer"][@"visible"] boolValue]) || !sameScope || actionsChanged;
  self.header.hidden = !visible; self.composer.hidden = !visible || ![state[@"composer"][@"visible"] boolValue];
  if (self.composer.hidden && self.host.window.firstResponder == self.editor) [self.host.window makeFirstResponder:self.host];
  if (!visible) {
    if (self.host.window.firstResponder == self.editor) [self.host.window makeFirstResponder:self.host];
    [self updateAccessibilityChildren];
    if (accessibilityChanged) NSAccessibilityPostNotification(self.host.window, NSAccessibilityLayoutChangedNotification);
    return NO;
  }
  NSDictionary *nav = state[@"navigation"], *composer = state[@"composer"];
  self.header.frame = [self rect:nav[@"rect"] viewport:state[@"viewport"]];
  self.headerSurface.frame = self.header.bounds;
  self.headerContent.frame = self.header.bounds;
  self.composer.frame = [self rect:composer[@"rect"] viewport:state[@"viewport"]];
  self.composerSurface.frame = self.composer.bounds;
  fitContent(self.composerSurface, self.composerContent);
  CGFloat w = self.header.bounds.size.width, h = self.header.bounds.size.height;
  BOOL hasTabs = [nav[@"computerVisible"] boolValue], hasSettings = [nav[@"settingsVisible"] boolValue], hasDetails = [nav[@"detailsVisible"] boolValue];
  CGFloat actionWidth = (hasTabs ? 134 : 0) + (hasSettings ? 32 : 0) + (hasDetails ? 62 : 0);
  CGFloat backWidth = [nav[@"backVisible"] boolValue] ? 36 : 0;
  self.title.stringValue = nav[@"title"];
  CGFloat textWidth = ceil(self.title.cell.cellSize.width);
  CGFloat identityWidth = MIN(MIN(260,MAX(96,textWidth+55)), MAX(60, w-actionWidth-backWidth-24));
  CGFloat identityX = MIN(MAX(backWidth+8,(w-identityWidth)/2),w-actionWidth-identityWidth-8);
  self.identity.frame = NSMakeRect(identityX,(h-40)/2,identityWidth,40);
  fitContent(self.identity,self.identityContent);
  self.actions.frame = NSMakeRect(w-actionWidth-4,(h-36)/2,actionWidth,36);
  fitContent(self.actions,self.actionsContent);
  self.actions.hidden = actionWidth == 0;
  self.backSurface.frame = NSMakeRect(4,(h-36)/2,backWidth,36);
  fitContent(self.backSurface,self.backContent);
  self.backSurface.hidden = backWidth == 0;
  self.back.frame = self.backContent.bounds;
  [self.back setAccessibilityLabel:nav[@"backLabel"] ?: @"Back"];
  CGFloat x = 0;
  self.tabs.hidden = !hasTabs;
  if (hasTabs) { self.tabs.frame = NSMakeRect(x,3,134,30); x += 134; }
  self.tabs.selectedSegment = [nav[@"selectedSurface"] isEqual:@"computer"] ? 1 : 0;
  self.details.hidden = !hasDetails;
  if (hasDetails) { self.details.frame = NSMakeRect(x,3,62,30); x += 62; }
  [self.details setAccessibilityLabel:nav[@"detailsLabel"] ?: @"Details"];
  self.settings.hidden = !hasSettings;
  if (hasSettings) self.settings.frame = NSMakeRect(x,3,32,30);
  self.face.frame = NSMakeRect(9,8,24,24);
  self.face.color = nav[@"avatarColor"] ?: @"white";
  self.face.group = [nav[@"group"] boolValue];
  self.face.needsDisplay = YES;
  self.subtitle.stringValue = nav[@"subtitle"] ?: @"";
  BOOL subtitle = self.subtitle.stringValue.length > 0;
  self.title.frame = NSMakeRect(39,subtitle ? 18 : 10,MAX(0,identityWidth-47),20);
  self.subtitle.frame = NSMakeRect(39,4,MAX(0,identityWidth-47),14);
  self.subtitle.hidden = !subtitle;
  w = self.composer.bounds.size.width; h = self.composer.bounds.size.height;
  BOOL attach = [composer[@"attachmentVisible"] boolValue], stop = [composer[@"stopVisible"] boolValue];
  self.attachment.hidden = !attach;
  self.attachment.enabled = ![composer[@"attachmentDisabled"] boolValue];
  self.attachment.frame = NSMakeRect(6,(h-32)/2,32,32);
  [self.attachment setAccessibilityLabel:composer[@"attachmentLabel"] ?: @"Add attachment"];
  self.submit.frame = NSMakeRect(w-64,(h-32)/2,58,32);
  self.submit.title = [composer[@"submitLabel"] localizedCaseInsensitiveContainsString:@"steer"] ? @"Steer" : @"↑";
  self.submit.toolTip = composer[@"submitLabel"];
  [self.submit setAccessibilityLabel:composer[@"submitLabel"]];
  self.submit.enabled = ![composer[@"submitDisabled"] boolValue];
  self.stop.hidden = !stop;
  self.stop.enabled = ![composer[@"stopDisabled"] boolValue];
  self.stop.title = @"Stop";
  [self.stop setAccessibilityLabel:composer[@"stopLabel"] ?: @"Stop"];
  self.stop.frame = NSMakeRect(w-118,(h-32)/2,52,32);
  CGFloat left = attach ? 42 : 12;
  self.scroll.frame = NSMakeRect(left,8,MAX(20,w-left-(stop ? 124 : 70)),MAX(28,h-16));
  self.editor.textContainer.containerSize = NSMakeSize(self.scroll.contentSize.width,CGFLOAT_MAX);
  [self.editor setFrameSize:NSMakeSize(self.scroll.contentSize.width,MAX(self.scroll.contentSize.height,self.editor.frame.size.height))];
  self.placeholder.frame = NSMakeRect(left+7,(h-20)/2,self.scroll.frame.size.width-10,20);
  self.placeholder.stringValue = composer[@"placeholder"];
  [self.editor setAccessibilityLabel:composer[@"placeholder"]];
  self.editor.editable = ![composer[@"disabled"] boolValue];
  if ((!sameScope || [state[@"draftSequence"] integerValue] >= self.sequence) && ![self.editor.string isEqual:composer[@"draft"]] && (!self.editor.hasMarkedText || !sameScope)) {
    NSRange selected = self.editor.selectedRange;
    self.editor.string = composer[@"draft"];
    self.editor.selectedRange = NSMakeRange(MIN(selected.location,self.editor.string.length),0);
  }
  self.placeholder.hidden = self.editor.string.length > 0;
  NSInteger focusRequest = [composer[@"focusRequest"] integerValue];
  if (!self.composer.hidden && self.editor.editable && focusRequest > self.lastFocusRequest && [self.host.window makeFirstResponder:self.editor]) {
    self.lastFocusRequest = focusRequest;
    self.editor.selectedRange = NSMakeRange(self.editor.string.length,0);
  }
  [self updateAccessibilityChildren];
  if (accessibilityChanged) NSAccessibilityPostNotification(self.host.window, NSAccessibilityLayoutChangedNotification);
  return YES;
}
- (void)action:(NSString *)type {
  if (!self.state || self.header.hidden) return;
  NSMutableDictionary *event = [@{@"type":type,@"scopeId":self.state[@"scopeId"],@"sessionId":self.state[@"sessionId"],@"sequence":@(self.sequence)} mutableCopy];
  if ([type isEqual:@"draft"] || [type isEqual:@"submit"]) event[@"draft"] = self.editor.string;
  emit(event);
}
- (void)textDidChange:(NSNotification *)notification {
  self.sequence += 1;
  self.placeholder.hidden = self.editor.string.length > 0;
  [self action:@"draft"];
}
- (BOOL)textView:(NSTextView *)textView shouldChangeTextInRange:(NSRange)range replacementString:(NSString *)replacement {
  return textView.string.length - range.length + replacement.length <= 60000;
}
- (BOOL)textView:(NSTextView *)textView doCommandBySelector:(SEL)selector {
  if (selector == @selector(insertNewline:) && !textView.hasMarkedText) {
    if (NSApp.currentEvent.modifierFlags & NSEventModifierFlagShift) return NO;
    [self submitAction]; return YES;
  }
  return NO;
}
- (void)submitAction { if (self.submit.enabled && self.editor.editable && !self.editor.hasMarkedText) { self.sequence += 1; [self action:@"submit"]; } }
- (void)stopAction { if (self.stop.enabled) [self action:@"stop"]; }
- (void)backAction { [self action:@"back"]; }
- (void)detailsAction { [self action:@"details"]; }
- (void)settingsAction { [self action:@"settings"]; }
- (void)attachmentAction { if (self.attachment.enabled) [self action:@"attachment"]; }
- (void)surfaceAction { [self action:self.tabs.selectedSegment == 1 ? @"computer" : @"chat"]; }
@end

#ifndef HERMES_NATIVE_CONTROLS_TEST
static HermesControls *controls;
static napi_value boolean(napi_env env, bool value) { napi_value result; napi_get_boolean(env,value,&result); return result; }
static napi_value attach(napi_env env, napi_callback_info info) {
  size_t count = 2; napi_value args[2]; napi_get_cb_info(env,info,&count,args,nullptr,nullptr);
  bool buffer = false; void *bytes = nullptr; size_t length = 0; napi_valuetype type;
  if (count != 2 || napi_is_buffer(env,args[0],&buffer) != napi_ok || !buffer || napi_typeof(env,args[1],&type) != napi_ok || type != napi_function || !NSThread.isMainThread) return boolean(env,false);
  napi_get_buffer_info(env,args[0],&bytes,&length);
  if (length != sizeof(void *)) return boolean(env,false);
  NSView *view = (__bridge NSView *)*(void **)bytes;
  if (!view || ![view isKindOfClass:NSView.class] || !view.window) return boolean(env,false);
  [controls detach]; controls = nil;
  if (eventFunction) { napi_release_threadsafe_function(eventFunction,napi_tsfn_abort); eventFunction = nullptr; }
  napi_value name; napi_create_string_utf8(env,"Hermes native controls",NAPI_AUTO_LENGTH,&name);
  if (napi_create_threadsafe_function(env,args[1],nullptr,name,0,1,nullptr,nullptr,nullptr,deliver,&eventFunction) != napi_ok) return boolean(env,false);
  controls = [[HermesControls alloc] initWithHost:view];
  if (!controls) { napi_release_threadsafe_function(eventFunction,napi_tsfn_abort); eventFunction = nullptr; }
  return boolean(env,controls != nil);
}
static napi_value present(napi_env env, napi_callback_info info) {
  size_t count = 1; napi_value args[1]; napi_get_cb_info(env,info,&count,args,nullptr,nullptr);
  if (count != 1 || !controls || !NSThread.isMainThread) return boolean(env,false);
  size_t length = 0;
  if (napi_get_value_string_utf8(env,args[0],nullptr,0,&length) != napi_ok || length > 262144) return boolean(env,false);
  std::string json(length+1,'\0'); napi_get_value_string_utf8(env,args[0],json.data(),length+1,&length);
  NSData *data = [NSData dataWithBytes:json.data() length:length];
  NSDictionary *state = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  if (![state isKindOfClass:NSDictionary.class]) return boolean(env,false);
  return boolean(env,[controls present:state]);
}
static napi_value hide(napi_env env, napi_callback_info info) {
  [controls hide];
  return boolean(env,true);
}
static napi_value detach(napi_env env, napi_callback_info info) {
  [controls detach]; controls = nil;
  if (eventFunction) { napi_release_threadsafe_function(eventFunction,napi_tsfn_abort); eventFunction = nullptr; }
  return boolean(env,true);
}
static napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor methods[] = {{"attach",nullptr,attach,nullptr,nullptr,nullptr,napi_default,nullptr},{"present",nullptr,present,nullptr,nullptr,nullptr,napi_default,nullptr},{"hide",nullptr,hide,nullptr,nullptr,nullptr,napi_default,nullptr},{"detach",nullptr,detach,nullptr,nullptr,nullptr,napi_default,nullptr}};
  napi_define_properties(env,exports,4,methods);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)

#endif

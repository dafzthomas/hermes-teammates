#define HERMES_NATIVE_CONTROLS_TEST
#import "NativeControls.mm"
#include <cassert>

@interface LifecycleView : NSObject
@property(getter=isHidden) BOOL hidden;
@end
@implementation LifecycleView
@end

@interface LifecycleEditor : NSObject
@property(copy) NSString *string;
@property NSRange selectedRange;
@property BOOL editable;
@property BOOL marked;
@property(strong) NSUndoManager *undoManager;
@end
@implementation LifecycleEditor
- (void)unmarkText { self.marked = NO; }
- (void)undoableChange {}
@end

@interface LifecycleControls : HermesControls
@property NSInteger replayCount;
@property NSInteger accessibleGroups;
@end
@implementation LifecycleControls
- (void)rebuildSurfaces {
  self.header = (id)[LifecycleView new];
  self.composer = (id)[LifecycleView new];
  self.header.hidden = YES;
  self.composer.hidden = YES;
  [self updateAccessibilityChildren];
}
- (void)updateAccessibilityChildren {
  self.accessibleGroups = !self.header.hidden + !self.composer.hidden;
}
- (BOOL)present:(NSDictionary *)state {
  self.replayCount += 1;
  self.state = state;
  self.header.hidden = ![state[@"visible"] boolValue];
  self.composer.hidden = self.header.hidden;
  [self updateAccessibilityChildren];
  return !self.header.hidden;
}
@end

int main() {
  @autoreleasepool {
    LifecycleControls *controls = [LifecycleControls new];
    LifecycleEditor *editor = [LifecycleEditor new];
    editor.undoManager = [NSUndoManager new];
    controls.editor = (id)editor;
    [controls rebuildSurfaces];
    [controls present:@{@"visible":@YES, @"composer":@{@"draft":@"previous document"}}];
    editor.string = @"unacknowledged native edit";
    editor.selectedRange = NSMakeRange(5,4);
    editor.editable = YES;
    editor.marked = YES;
    [[editor.undoManager prepareWithInvocationTarget:editor] undoableChange];
    controls.sequence = 7;
    controls.lastFocusRequest = 9;
    [controls accessibilityChanged:nil];
    assert(controls.replayCount == 2 && controls.accessibleGroups == 2);

    [controls hide];
    assert(!controls.state && editor.string.length == 0);
    assert(editor.selectedRange.location == 0 && editor.selectedRange.length == 0);
    assert(!editor.editable && !editor.marked && !editor.undoManager.canUndo);
    assert(controls.sequence == 0 && controls.lastFocusRequest == 0);
    assert(controls.header.hidden && controls.composer.hidden && controls.accessibleGroups == 0);
    [controls accessibilityChanged:nil];
    [controls accessibilityChanged:nil];
    assert(!controls.state && editor.string.length == 0 && !editor.editable);
    assert(controls.replayCount == 2 && controls.accessibleGroups == 0);
    assert(controls.header.hidden && controls.composer.hidden);

    [controls present:@{@"visible":@YES, @"composer":@{@"draft":@"current document"}}];
    assert(controls.replayCount == 3 && controls.accessibleGroups == 2);
    [controls hide];
    [controls hide];
    [controls accessibilityChanged:nil];
    assert(controls.replayCount == 3 && controls.accessibleGroups == 0);
    puts("Native Mac hide/accessibility lifecycle regressions passed");
  }
}

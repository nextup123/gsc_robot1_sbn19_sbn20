function toast(text, color) {
      Toastify({
        text,
        duration: 3000,
        gravity: "top",
        position: "right",
        close: true,
        backgroundColor: color
      }).showToast();
    }


    function showToast(message, type = 'success', timeout = 3) {
      let background;

      switch (type) {
        case 'warn':
          background = '#f39c12';
          break;
        case 'failure':
          background = '#e74c3c';
          break;
        case 'success':
        default:
          background = '#2ecc71';
          break;
      }

      Toastify({
        text: message,
        duration: timeout * 1000,
        gravity: 'top',
        position: 'right',
        close: true,
        stopOnFocus: true,
        style: {
          background
        }
      }).showToast();
    }
    function clearAllToasts() {
      document
        .querySelectorAll('.toastify')
        .forEach(toast => toast.remove());
    }
    const toastTopic = new ROSLIB.Topic({
      ros: ros,
      name: '/bt_toast_popup',
      messageType: 'std_msgs/String'
    });

    toastTopic.subscribe((message) => {
      const content = message.data || '';
      const parts = content.split(',');

      if (parts.length === 0) return;

      const msg = parts[0].trim();
      const type = parts[1]?.trim().toLowerCase() || 'success';
      const timeout = parts[2] ? parseFloat(parts[2]) : 3;

      const validTypes = ['success', 'warn', 'failure'];
      const toastType = validTypes.includes(type) ? type : 'success';

      showToast(msg, toastType, timeout);
    });
    const startBtTopic = new ROSLIB.Topic({
      ros: ros,
      name: '/start_bt',
      messageType: 'std_msgs/Bool'
    });

    startBtTopic.subscribe(() => {
      clearAllToasts();
    });
